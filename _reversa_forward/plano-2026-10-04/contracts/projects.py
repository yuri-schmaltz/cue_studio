"""Schemas Pydantic propostos para o domínio Projects (A16, A10).

Serializa para camelCase (alinhado com frontend). Aceita snake_case na entrada.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


_PROJECT_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    from_attributes=True,
)


ProjectType = Literal["music-video", "short-film", "custom"]
DirectorFormat = Literal["mp4", "webm", "mov"]
Workflow = Literal["basic", "expert"]
SceneStatus = Literal["pending", "running", "review", "done", "failed"]
QueueState = Literal[
    "queued", "preparing", "running", "awaiting_review",
    "done", "failed", "cancelled",
]


class Briefing(BaseModel):
    model_config = _PROJECT_CONFIG
    intent: Optional[str] = None
    audience: Optional[str] = None
    duration_sec: Optional[int] = Field(default=None, ge=5, le=600)
    references: list[str] = Field(default_factory=list)


class SceneCard(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    index: int
    duration_sec: float
    takes: int = 0
    status: SceneStatus = "pending"
    prompt: str
    thumb: Optional[str] = None


class DirectorOptions(BaseModel):
    model_config = _PROJECT_CONFIG
    skill: Optional[str] = None
    format: Optional[DirectorFormat] = None
    workflow: Optional[Workflow] = None


class ProjectSummary(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    name: str
    type: ProjectType
    preset_id: Optional[str] = None
    updated_at: datetime
    thumb: Optional[str] = None


class ProjectCreate(BaseModel):
    model_config = _PROJECT_CONFIG
    name: str = Field(min_length=1, max_length=80)
    type: ProjectType
    preset_id: Optional[str] = None


class Project(ProjectSummary):
    model_config = _PROJECT_CONFIG
    briefing: Briefing = Field(default_factory=Briefing)
    scenes: list[SceneCard] = Field(default_factory=list)
    options: DirectorOptions = Field(default_factory=DirectorOptions)


class ProjectListResponse(BaseModel):
    model_config = _PROJECT_CONFIG
    items: list[ProjectSummary]
    page: int = 1
    total: int = 0


class ContinueProject(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    name: str
    section: str
    updated_at: datetime


class RecentOutput(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    project_id: str
    thumb: str
    created_at: datetime


class QueueItem(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    project_id: str
    label: str
    state: QueueState
    progress: float = Field(ge=0, le=1, default=0)
    expected_sec: Optional[int] = None
    position: Optional[int] = None
    updated_at: datetime


class DashboardSummary(BaseModel):
    model_config = _PROJECT_CONFIG
    continue_project: Optional[ContinueProject] = None
    queue: list[QueueItem] = Field(default_factory=list)
    recent_outputs: list[RecentOutput] = Field(default_factory=list)


# Editor (A05)
class EditorClip(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    media_path: str
    start: float = 0.0
    duration: float
    label: Optional[str] = None
    audio_gain: float = 1.0


class EditorProject(BaseModel):
    model_config = _PROJECT_CONFIG
    id: str
    title: str
    clips: list[EditorClip] = Field(default_factory=list)
    updated_at: datetime


class EditorProjectCreate(BaseModel):
    model_config = _PROJECT_CONFIG
    title: str = "Untitled"


class ApiErrorPayload(BaseModel):
    model_config = _PROJECT_CONFIG
    code: str
    message: str
    operation_id: str
    cause: Optional[str] = None