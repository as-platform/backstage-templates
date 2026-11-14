from fastapi import FastAPI

SERVICE = "${{ values.name }}"


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/")
    def index() -> dict[str, str]:
        return {"service": SERVICE}

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
