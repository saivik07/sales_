from fastapi import FastAPI, HTTPException 
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.params import Depends
from pydantic import BaseModel
from sqlalchemy import create_engine 
import pandas as pd
from fastapi import UploadFile, File, BackgroundTasks
from datetime import datetime
import shutil
import os 
from ml import process_and_store_data
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.sql import func
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi import BackgroundTasks # Add this to your imports

app = FastAPI() 
 
app.add_middleware( 
    CORSMiddleware, 
    allow_origins=["http://127.0.0.1:5500"], 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"], 
) 
 
DATABASE_URL = os.getenv( 
    "DATABASE_URL", 
    "postgresql://postgres:saicharlotte@localhost:5432/my_project_db" 
) 

engine = create_engine(DATABASE_URL) 
SessionLocal= sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base= declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(Text, nullable=False)
    role = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

Base.metadata.create_all(bind=engine)
SECRET_KEY = "CHANGE_THIS_TO_RANDOM_SECRET"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def hash_password(password: str):
    return pwd_context.hash(password)

def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict):
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    data.update({"exp": expire})
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def authenticate_user(username: str, password: str, role: str, db: Session):
    user = db.query(User).filter(User.username == username).first()

    if not user:
        return None
    if user.role != role:
        return None
    if not verify_password(password, user.hashed_password):
        return None

    return user

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

# ==============================
# MODEL MANAGEMENT STATE
# ==============================
training_status = "Idle"
last_trained_time = None
UPLOAD_PATH = "uploaded_data.csv"

 # ==================================================
# RETRAIN MODEL
# ==================================================
def retrain_pipeline():
    global training_status, last_trained_time

    try:
        training_status = "Training"

        process_and_store_data(UPLOAD_PATH)

        training_status = "Completed"
        last_trained_time = datetime.now().strftime("%d %b %Y, %I:%M %p")

    except Exception as e:
        training_status = f"Failed: {str(e)}"

class LoginRequest(BaseModel):
    username: str
    password: str
    role: str

@app.post("/api/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):

    user = authenticate_user(data.username, data.password, data.role, db)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials or role")

    token = create_access_token({
        "sub": user.username,
        "role": user.role
    })

    return {
        "access_token": token,
        "token_type": "bearer"
    }

@app.post("/api/retrain")
def retrain_model(user=Depends(require_admin)):
    global training_status, last_trained_time

    try:
        training_status = "Training"

        process_and_store_data(UPLOAD_PATH)

        training_status = "Completed"
        last_trained_time = datetime.now().strftime("%d %b %Y, %I:%M %p")

    except Exception as e:
        training_status = f"Failed: {str(e)}"

    # Your existing retraining logic here
    return {"message": "Model retrained successfully"}

# ==================================================
# MODEL STATUS
# ==================================================

@app.get("/api/model-status")
def model_status(user=Depends(require_admin)):
    return {
        "status": training_status,
        "last_trained": last_trained_time or "Not trained yet"
    }

# ==================================================
# UPLOAD CSV
# ==================================================

@app.post("/api/upload-csv")
async def upload_csv(file: UploadFile = File(...), user=Depends(require_admin)):
    global UPLOAD_PATH

    if not file.filename.endswith(".csv"):
        return {"error": "Only CSV files allowed"}

    with open(UPLOAD_PATH, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"message": "CSV uploaded successfully"}

 
# ================================================== 
# DASHBOARD KPIs 
# ================================================== 
@app.get("/api/dashboard-stats") 
def get_dashboard_stats(user=Depends(get_current_user)): 
 
    stats = pd.read_sql(""" 
        SELECT 
            SUM("Monetary") AS total_sales, 
            COUNT(*) AS total_customers 
        FROM customer_segments
    """, engine).iloc[0] 
 
    new_customers = pd.read_sql(""" 
        SELECT COUNT(*) AS new_customers 
        FROM customer_segments 
        WHERE "Recency" <= 30 
    """, engine).iloc[0]["new_customers"] 
 
    accuracy_row = pd.read_sql(""" 
        SELECT forecast_accuracy 
        FROM forecast_metrics 
        LIMIT 1 
    """, engine) 
 
    accuracy = ( 
        float(accuracy_row.iloc[0]["forecast_accuracy"]) 
        if not accuracy_row.empty 
        else 0 
    ) 
 
    return { 
        "total_sales": float(stats["total_sales"] or 0), 
        "total_customers": int(stats["total_customers"] or 0), 
        "new_customers": int(new_customers or 0), 
        "forecast_accuracy": round(accuracy, 2) 
    } 
 
# ================================================== 
# FORECAST DATA 
# ================================================== 
@app.get("/api/forecast") 
def get_forecast(user=Depends(get_current_user)): 
    df = pd.read_sql(""" 
        SELECT 
            forecast_month, 
            predicted_sales, 
            lower_ci, 
            upper_ci 
        FROM sales_forecast 
        ORDER BY forecast_month 
    """, engine) 
 
    return df.to_dict(orient="records") 
 
# ================================================== 
# FORECAST SUMMARY 
# ================================================== 
@app.get("/api/forecast-summary") 
def forecast_summary(user=Depends(get_current_user)): 
    df = pd.read_sql(""" 
        SELECT forecast_month, predicted_sales 
        FROM sales_forecast 
        ORDER BY forecast_month 
    """, engine) 
 
    if df.empty: 
        return { 
            "avg_monthly_sales": 0, 
            "growth_rate": 0, 
            "best_month": "-" 
        } 
 
    avg_sales = df["predicted_sales"].mean() 
 
    growth_rate = ( 
        (df.iloc[-1]["predicted_sales"] - df.iloc[0]["predicted_sales"]) 
        / df.iloc[0]["predicted_sales"] 
    ) * 100 
 
    best_month = ( 
        df.loc[df["predicted_sales"].idxmax(), "forecast_month"] 
        .strftime("%B") 
    ) 
 
    return { 
        "avg_monthly_sales": round(avg_sales, 2), 
        "growth_rate": round(growth_rate, 2), 
        "best_month": best_month 
    } 
 
# ================================================== 
# CUSTOMER SEGMENTS 
# ================================================== 
@app.get("/api/segments") 
def get_segments(user=Depends(get_current_user)): 
    df = pd.read_sql(""" 
        SELECT "Segment_Label", COUNT(*) AS count 
        FROM customer_segments 
        GROUP BY "Segment_Label" 
        ORDER BY count DESC 
    """, engine) 
 
    return df.to_dict(orient="records") 

    # ==================================================
# PRODUCT LEVEL FORECAST (Single Product)
# ==================================================
@app.get("/api/product-forecast")
def get_product_forecast(user=Depends(get_current_user)):

    df = pd.read_sql("""
        SELECT 
            product_id,         
            forecast_month,
            predicted_sales,
            lower_ci,
            upper_ci
        FROM product_sales_forecast
        ORDER BY forecast_month
    """, engine)

    return df.to_dict(orient="records")
