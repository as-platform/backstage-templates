FROM zot.homelab/golden/python-base:stable AS build

ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_NO_BUILD=1

WORKDIR /home/app

COPY --chown=app:app pyproject.toml uv.lock ./

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN uv export --frozen --no-dev --no-emit-project \
 | uv pip install --target /home/app/site --no-deps -r -

COPY --chown=app:app app ./app

FROM zot.homelab/golden/runtime:python

WORKDIR /app

COPY --from=build /home/app/site ./site
COPY --from=build /home/app/app ./app

ENV PYTHONPATH=/app/site:/app \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080

USER 65532:65532

ENTRYPOINT ["/usr/bin/python3.13", "-m", "app"]
