"""Strict boundaries between untrusted model output and workspace data."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing import Annotated

Category = Literal['general', 'brand_voice', 'target_audience', 'approved_claim',
                   'prohibited_claim', 'disclaimer', 'visual_identity', 'restriction', 'terminology']
Severity = Literal['error', 'warning', 'info']
MediaType = Literal['text', 'image', 'video']
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=5000, strip_whitespace=True)]


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Observation(StrictOutput):
    channel: Literal['visible_text', 'speech', 'visual']
    text: ShortText
    timestamp_seconds: float | None = Field(default=None, ge=0, le=120)
    certainty: Literal['observed', 'inferred']


class SemanticFinding(StrictOutput):
    rule_id: int = Field(ge=1)
    media_type: MediaType
    excerpt: str = Field(max_length=2000)
    severity: Severity
    explanation: ShortText
    suggested_correction: ShortText
    rewrite: str | None = Field(default=None, max_length=2000)
    confidence: float = Field(ge=0, le=1)
    evidence_type: Literal['observed', 'inferred']
    timestamp_seconds: float | None = Field(default=None, ge=0, le=120)


class ModelReport(StrictOutput):
    text_reviewed: bool
    visual_reviewed: bool
    speech_reviewed: bool
    observations: list[Observation] = Field(max_length=80)
    findings: list[SemanticFinding] = Field(max_length=50)
    limitations: list[ShortText] = Field(max_length=12)


class ProposedRule(StrictOutput):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal['fact', 'prohibited', 'required', 'color', 'semantic']
    value: str = Field(min_length=1, max_length=2000)
    unit: str = Field(max_length=20)
    category: Category
    severity: Severity
    evidence: ShortText
    rationale: str = Field(min_length=1, max_length=2000)
    page: int = Field(ge=1)
    applies_when: Literal['always', 'range_claim']


class GuidelineReport(StrictOutput):
    candidates: list[ProposedRule] = Field(max_length=50)
