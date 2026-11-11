"""The server: the API routes and the built frontend, on one port."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from paths import FRONTEND_DIST
from ai import load_env_file
from db import audit_log, connection
from routes import actions, cases


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    load_env_file()
    connection.open_pool()
    audit_log.create_audit_table()
    yield
    connection.close_pool()


app = FastAPI(title="Acadza Report Fix", lifespan=lifespan)
app.include_router(cases.router)
app.include_router(actions.router)

# The frontend routes come last, so they never hide an API route.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def serve_frontend(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, f"No API route /{path}.")
        file = (FRONTEND_DIST / path).resolve()
        # Only files inside dist are served, so a path like ../../.env can never leak.
        if path and file.is_file() and FRONTEND_DIST.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
