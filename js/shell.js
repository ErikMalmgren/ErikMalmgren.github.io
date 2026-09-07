/* shell.js — turns each static page into an interactive terminal.
 *
 * Progressive enhancement, strictly. Every page is a complete, readable
 * document on its own; this script only ever *adds* behaviour. If it fails to
 * load, fails to parse, or throws during boot, the page stays exactly as the
 * server sent it and every link still navigates normally. Nothing below may
 * assume it is the only way to reach the content.
 */
(function () {
    'use strict';

    var PROMPT = 'erik@malmgren:~$';

    /* Commands that print part of the site. `sel` narrows a page to one
     * section; omit it to take the whole <main>. `help` is in here rather than
     * generated: help.html is the one list of commands, so the printed list and
     * the page a visitor without JavaScript reads cannot drift apart. */
    var PAGES = {
        about:      { url: '/about.html', sel: '#bio' },
        education:  { url: '/about.html', sel: '#education' },
        skills:     { url: '/about.html', sel: '#skills' },
        coursework: { url: '/about.html', sel: '#coursework' },
        projects:  { url: '/projects.html' },
        cv:        { url: '/cv.html' },
        help:      { url: '/help.html' },
        contact:   { url: '/contact.html' },
        whoami:    { url: '/', sel: '#whoami' }
    };

    /* Tab completion, and the order LINK_TO_CMD resolves ties in. What `help`
     * lists lives in help.html. */
    var ORDER = ['whoami', 'about', 'education', 'skills', 'coursework',
                 'projects', 'cv', 'contact', 'clear', 'help'];

    var NAV_TO_CMD = {
        '/': 'whoami',
        '/about.html': 'about',
        '/projects.html': 'projects',
        '/cv.html': 'cv',
        '/contact.html': 'contact',
        '/help.html': 'help',
        /* clear.html exists so the nav link has somewhere to go without
         * JavaScript: it is the screen the command leaves you on. */
        '/clear.html': 'clear'
    };

    /* A link into a section the shell can print runs the command instead of
     * navigating. Built from PAGES so the two can't drift, and walked in ORDER
     * so a section reachable under two names would resolve to the first one
     * listed. Keys are hrefs exactly as authored in the markup — the same
     * literal match NAV_TO_CMD uses. */
    var LINK_TO_CMD = {};
    ORDER.forEach(function (name) {
        var page = PAGES[name];
        if (page && page.sel) LINK_TO_CMD[page.url + page.sel] = name;
    });

    function cmdForHref(href) {
        if (!href) return null;
        return NAV_TO_CMD[href] || LINK_TO_CMD[href] || null;
    }

    var main = document.getElementById('main');
    if (!main || !window.fetch || !window.DOMParser) return;

    var log, form, input;
    var cache = new Map();
    var history_ = [];
    var histPos = 0;
    var cancelTyping = null;

    function reduced() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /* Focusing the prompt pops the on-screen keyboard on a touch device, which
     * is not what someone tapping a link asked for. A mouse or trackpad always
     * has a physical keyboard behind it, so focus is only helpful there.
     * Queried at call time, not cached — a tablet can gain a keyboard. */
    function pointerFine() {
        return window.matchMedia('(pointer: fine)').matches;
    }

    function focusPrompt() {
        if (pointerFine()) input.focus();
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function promptSpan() {
        var s = el('span', 'prompt', PROMPT);
        s.setAttribute('aria-hidden', 'true');
        return s;
    }

    /* ---------- output ---------- */

    function echo(text) {
        var p = el('p', 'cmd echo');
        p.appendChild(promptSpan());
        p.appendChild(document.createTextNode(' ' + text));
        log.appendChild(p);
    }

    function print(text, cls) {
        log.appendChild(el('p', cls || 'out-line', text));
    }

    function scrollToPrompt() {
        /* Instant, never smooth: a terminal jumps to its newest line, and a
         * queued smooth scroll would still be animating when the next command
         * starts its own.
         *
         * When the shell layout is active the scrollback scrolls inside itself
         * and the prompt never moves. Below that layout's min-height guard the
         * page flows normally, so fall back to scrolling the document. */
        if (log.scrollHeight - log.clientHeight > 1) {
            log.scrollTop = log.scrollHeight;
        } else {
            form.scrollIntoView({ block: 'end' });
        }
    }

    /* ---------- fetching ---------- */

    function fetchDoc(url) {
        if (cache.has(url)) return Promise.resolve(cache.get(url));
        return fetch(url, { headers: { Accept: 'text/html' } })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                cache.set(url, doc);
                return doc;
            });
    }

    /* Lift a node's children into a plain <div>. Returning the node itself
     * would duplicate ids that already exist in this document. */
    function unwrap(node) {
        var box = el('div', 'out');
        var clone = node.cloneNode(true);
        /* The static prompt line is decoration for the no-JS page; the live
         * input replaces it here. */
        clone.querySelectorAll('[data-static-prompt]').forEach(function (n) { n.remove(); });
        /* The section's own heading is a rendered prompt, which would read as a
         * second echo of a command the user did not type. */
        var head = clone.querySelector('.cmd');
        if (head) head.remove();
        while (clone.firstChild) box.appendChild(clone.firstChild);
        return box;
    }

    /* ---------- commands ---------- */

    function run(raw) {
        var line = raw.trim();
        echo(line);
        history_.push(line);
        histPos = history_.length;

        if (!line) { scrollToPrompt(); return Promise.resolve(); }

        /* Commands are matched case-insensitively — `Cv` is `cv`. Only the
         * lookup is folded; anything echoed back keeps what was typed. */
        var typed = line.split(/\s+/)[0];
        var cmd = typed.toLowerCase();

        if (cmd === 'clear') {
            log.replaceChildren();
            return Promise.resolve();
        }

        /* hasOwnProperty, not a bare lookup: `constructor` and friends are
         * inherited from Object.prototype and would otherwise read as commands. */
        var page = Object.prototype.hasOwnProperty.call(PAGES, cmd) && PAGES[cmd];
        if (!page) {
            print('bash: ' + typed + ': command not found', 'err');
            print("Type `help` for a list of commands.", 'muted');
            scrollToPrompt();
            return Promise.resolve();
        }

        return fetchDoc(page.url).then(function (doc) {
            var node = page.sel ? doc.querySelector(page.sel) : doc.querySelector('main');
            if (!node) throw new Error('no content at ' + (page.sel || 'main'));
            log.appendChild(unwrap(node));

            var title = doc.querySelector('title');
            if (title) document.title = title.textContent;
            var target = page.url + (page.sel ? page.sel : '');
            window.history.pushState({ cmd: cmd }, '', target);
            markNav(page.url);
            scrollToPrompt();
        }).catch(function (err) {
            print('bash: ' + cmd + ': cannot load (' + err.message + ')', 'err');
            scrollToPrompt();
        });
    }

    function markNav(url) {
        document.querySelectorAll('.nav a').forEach(function (a) {
            if (a.getAttribute('href') === url) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });
    }

    /* ---------- typing animation ---------- */

    /* Resolves true if the whole command was typed, false if the user
     * interrupted — in which case the caller must not run it. */
    function typeCommand(text) {
        if (reduced()) {
            input.value = text;
            focusPrompt();
            return Promise.resolve(true);
        }
        return new Promise(function (resolve) {
            var i = 0;
            var timer = null;
            cancelTyping = function (complete) {
                clearTimeout(timer);
                cancelTyping = null;
                input.value = complete ? text : '';
                resolve(!!complete);
            };
            var tick = function () {
                input.value = text.slice(0, ++i);
                if (i >= text.length) { cancelTyping(true); return; }
                timer = setTimeout(tick, 28 + Math.random() * 22);
            };
            input.value = '';
            focusPrompt();
            timer = setTimeout(tick, 50);
        });
    }

    /* Type a command into the prompt and run it, as if the visitor had. Used by
     * the nav and by in-page links to printable sections. */
    function runTyped(cmd) {
        if (cancelTyping) cancelTyping(false);
        typeCommand(cmd).then(function (ok) {
            if (!ok) return;
            input.value = '';
            run(cmd);
        });
    }

    /* Let modified clicks open a new tab, as any link should. */
    function plainClick(e) {
        return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    /* ---------- boot ---------- */

    function boot() {
        log = el('div', 'log');
        /* Focusable so the scrollback can be reached and scrolled by keyboard;
         * ArrowUp/Down belong to command history once the input has focus. */
        log.tabIndex = 0;
        log.setAttribute('aria-label', 'Terminal output');
        main.appendChild(log);
        /* Move the server-rendered content into the scrollback. It becomes the
         * output of the command this page represents, already run. */
        while (main.firstChild !== log) log.appendChild(main.firstChild);
        log.querySelectorAll('[data-static-prompt]').forEach(function (n) { n.remove(); });

        form = el('form', 'line');
        form.setAttribute('novalidate', '');

        var label = el('label', 'visually-hidden', 'Terminal command');
        label.setAttribute('for', 'cmd');

        input = el('input');
        input.id = 'cmd';
        input.name = 'cmd';
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');

        form.appendChild(label);
        form.appendChild(promptSpan());
        form.appendChild(input);
        main.appendChild(form);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var v = input.value;
            input.value = '';
            run(v);
        });

        input.addEventListener('keydown', function (e) {
            /* A keystroke during the animation cancels it and clears the line,
             * so the user's own typing starts from empty rather than being
             * spliced into a half-typed command. */
            if (cancelTyping && e.key !== 'Enter') cancelTyping(false);

            if (e.key === 'Tab') {
                e.preventDefault();
                var typed = input.value.trim();
                var v = typed.toLowerCase();
                var hits = ORDER.filter(function (n) { return n.indexOf(v) === 0; });
                /* Completing rewrites the line in the command's own case, so
                 * `CV<Tab>` settles on `cv` rather than leaving a mixed-case
                 * line that only works because the lookup is folded. */
                if (hits.length === 1) input.value = hits[0];
                else if (hits.length > 1) { echo(typed); print(hits.join('   ')); scrollToPrompt(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (histPos > 0) input.value = history_[--histPos] || '';
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (histPos < history_.length - 1) input.value = history_[++histPos] || '';
                else { histPos = history_.length; input.value = ''; }
            }
        });

        /* Links pointing at a section the shell can print run it as a command
         * instead of reloading the page. Delegated, because most of these links
         * arrive later as command output rather than existing at boot. Anything
         * else — a PDF, GitHub, a whole page — navigates normally. */
        main.addEventListener('click', function (e) {
            var a = e.target.closest('a');
            if (!a || !plainClick(e)) return;
            var cmd = cmdForHref(a.getAttribute('href'));
            if (!cmd) return;
            e.preventDefault();
            runTyped(cmd);
        });

        /* Clicking the terminal focuses the prompt — but not when the user is
         * selecting text or aiming at a link, and not on touch, where it would
         * throw up the keyboard on every stray tap. Tapping the input itself
         * still focuses natively, which is the deliberate gesture. */
        main.addEventListener('click', function (e) {
            if (String(window.getSelection())) return;
            if (e.target.closest('a, button, input, label, dt')) return;
            focusPrompt();
        });

        document.querySelectorAll('.nav a').forEach(function (a) {
            var cmd = NAV_TO_CMD[a.getAttribute('href')];
            if (!cmd) return;
            a.addEventListener('click', function (e) {
                if (!plainClick(e)) return;
                e.preventDefault();
                runTyped(cmd);
            });
        });

        /* Back/forward unwinds to a real URL; let the browser load it rather
         * than trying to rewind an accumulating transcript. */
        window.addEventListener('popstate', function () { window.location.reload(); });

        document.documentElement.classList.add('has-shell');

        /* Announce only what arrives *after* boot — setting this before the
         * content move would make a screen reader read the whole page twice. */
        window.setTimeout(function () {
            log.setAttribute('role', 'log');
            log.setAttribute('aria-live', 'polite');
        }, 0);
    }

    try {
        boot();
    } catch (err) {
        /* Leave the static page alone rather than shipping a half-built shell. */
        if (window.console) window.console.error('shell: boot failed', err);
    }
}());
