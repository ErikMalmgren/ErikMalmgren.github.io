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
     * section; omit it to take the whole <main>. */
    var PAGES = {
        about:    { url: '/about.html',    desc: 'background and education' },
        projects: { url: '/projects.html', desc: "things I've built" },
        cv:       { url: '/cv.html',       desc: 'experience and documents' },
        contact:  { url: '/', sel: '#contact',   desc: 'how to reach me' },
        erikfetch:{ url: '/', sel: '#erikfetch', desc: 'the summary screen' },
        /* Undocumented alias — `whoami` is the reflex, erikfetch is the name. */
        whoami:   { url: '/', sel: '#erikfetch', desc: 'the summary screen' }
    };

    var BUILTINS = {
        ls:    'list pages',
        clear: 'clear the screen',
        help:  'this message'
    };

    /* Order shown by `help`. */
    var ORDER = ['erikfetch', 'about', 'projects', 'cv', 'contact', 'ls', 'clear', 'help'];

    var NAV_TO_CMD = {
        '/': 'erikfetch',
        '/about.html': 'about',
        '/projects.html': 'projects',
        '/cv.html': 'cv'
    };

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

    function cmdHelp() {
        var dl = el('dl', 'kv helplist');
        ORDER.forEach(function (name) {
            var desc = (PAGES[name] && PAGES[name].desc) || BUILTINS[name];
            dl.appendChild(el('dt', null, name));
            dl.appendChild(el('dd', null, desc));
        });
        log.appendChild(dl);
    }

    function cmdLs() {
        print('index.html   about.html   projects.html   cv.html');
    }

    function names() {
        /* Completion offers the alias too, even though `help` does not list it. */
        return ORDER.concat(['whoami']);
    }

    function run(raw) {
        var line = raw.trim();
        echo(line);
        history_.push(line);
        histPos = history_.length;

        if (!line) { scrollToPrompt(); return Promise.resolve(); }

        var cmd = line.split(/\s+/)[0];

        if (cmd === 'clear') {
            log.replaceChildren();
            return Promise.resolve();
        }
        if (cmd === 'help') { cmdHelp(); scrollToPrompt(); return Promise.resolve(); }
        if (cmd === 'ls') { cmdLs(); scrollToPrompt(); return Promise.resolve(); }

        var page = PAGES[cmd];
        if (!page) {
            print('bash: ' + cmd + ': command not found', 'err');
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
                var v = input.value.trim();
                var hits = names().filter(function (n) { return n.indexOf(v) === 0; });
                if (hits.length === 1) input.value = hits[0];
                else if (hits.length > 1) { echo(v); print(hits.join('   ')); scrollToPrompt(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (histPos > 0) input.value = history_[--histPos] || '';
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (histPos < history_.length - 1) input.value = history_[++histPos] || '';
                else { histPos = history_.length; input.value = ''; }
            }
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
                /* Let modified clicks open a new tab, as any link should. */
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                if (cancelTyping) cancelTyping(false);
                typeCommand(cmd).then(function (ok) {
                    if (!ok) return;
                    input.value = '';
                    run(cmd);
                });
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
