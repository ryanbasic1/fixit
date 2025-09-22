from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .database import create_tables
from .routes_auth import router as auth_router
from .routes_complaints import router as complaints_router
from .routes_admin import router as admin_router
from .routes_classifier import router as classifier_router

app = FastAPI(title="Civic AI Backend", version="1.0.0")

# Configure CORS
origins = [
    "http://localhost:5500",    # VS Code Live Server default
    "http://127.0.0.1:5500",   # VS Code Live Server alternative
    "http://localhost:8000",    # Backend server
    "http://127.0.0.1:8000",   # Backend server alternative
    "http://192.168.31.102:5500", # Local network IP
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

create_tables()

BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BACKEND_ROOT / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

app.include_router(auth_router)
app.include_router(complaints_router)
app.include_router(admin_router)
app.include_router(classifier_router)

@app.get("/")
async def root():
    return {"message": "Civic AI Backend API", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "message": "Civic AI Backend is running"}
