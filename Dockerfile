# Serves the same static folder that GitHub Pages serves today.
#
# Not deployed yet — this exists so the self-hosting path is proven and ready.
# CI builds it on every push so it can't rot.
#
#   docker build -t malmgren-dev .
#   docker run --rm -p 8080:80 malmgren-dev

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

# Files copied above that don't belong in a web root. Everything else is
# excluded by .dockerignore; these are the ones Docker copies regardless.
RUN rm -rf /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/Dockerfile

HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -q -O /dev/null http://localhost/healthz || exit 1
