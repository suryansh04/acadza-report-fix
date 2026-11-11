from typing import Literal

from pydantic import BaseModel, Field

import paths  # noqa: F401  (puts the engine on the import path)
from ai import Edit


class ActionRequest(BaseModel):
    report_id: str
    action: Literal["approve", "edit", "reject"]
    edits: list[Edit] = []
    reply: str = ""
    note: str = ""
    reviewer: str
    save_anyway: bool = False


class BulkApproveRequest(BaseModel):
    report_ids: list[str] = Field(min_length=1)
    reviewer: str


class UndoRequest(BaseModel):
    entry_ids: list[int] = Field(min_length=1)
    reviewer: str
