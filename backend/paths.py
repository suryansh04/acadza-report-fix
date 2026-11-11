import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = PROJECT_DIR / "engine"
CASES_PATH = PROJECT_DIR / "cases.json"
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"

# The backend reuses the engine's checks and guards, which import each other by plain module name.
# So import this module before any engine module.
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
