import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    mean_absolute_percentage_error,
    mean_absolute_error,
    mean_squared_error
)
from prophet import Prophet

# --------------------------------------------------
# Database Connection
# --------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:saicharlotte@localhost:5432/my_project_db"
)
engine = create_engine(DATABASE_URL)

# ==================================================
# PRODUCT LEVEL FORECASTING FUNCTION
# ==================================================
def product_level_forecasting(df):

    print("Running product-level forecasting...")

    top_products = (
        df.groupby("product_id")["sales"]
        .sum()
        .sort_values(ascending=False)
        .head(1)   # Change to 3 if needed
        .index
        .tolist()
    )

    all_forecasts = []
    all_metrics = []

    for product in top_products:

        product_df = df[df["product_id"] == product]

        monthly = (
            product_df
            .set_index("order_date")
            .resample("MS")["sales"]
            .sum()
            .reset_index()
            .rename(columns={"order_date": "ds", "sales": "y"})
        )

        if len(monthly) < 24:
            continue

        # Train-Test Split
        train = monthly[:-6]
        test = monthly[-6:]

        model = Prophet(yearly_seasonality=True)
        model.fit(train)

        future = model.make_future_dataframe(periods=6, freq="MS")
        forecast = model.predict(future)

        pred = forecast.tail(6)["yhat"]

        mae = mean_absolute_error(test["y"], pred)
        rmse = np.sqrt(mean_squared_error(test["y"], pred))
        mape = mean_absolute_percentage_error(test["y"], pred)

        all_metrics.append({
            "product_id": product,
            "MAE": round(mae, 2),
            "RMSE": round(rmse, 2),
            "MAPE": round(mape * 100, 2)
        })

        # Final 12-month forecast
        final_model = Prophet(yearly_seasonality=True)
        final_model.fit(monthly)

        future_12 = final_model.make_future_dataframe(periods=12, freq="MS")
        forecast_12 = final_model.predict(future_12)

        forecast_12 = forecast_12.tail(12)[[
            "ds", "yhat", "yhat_lower", "yhat_upper"
        ]]

        forecast_12["product_id"] = product
        forecast_12.rename(columns={
            "ds": "forecast_month",
            "yhat": "predicted_sales",
            "yhat_lower": "lower_ci",
            "yhat_upper": "upper_ci"
        }, inplace=True)

        all_forecasts.append(forecast_12)

    if all_forecasts:
        pd.concat(all_forecasts).to_sql(
            "product_sales_forecast",
            engine,
            if_exists="replace",
            index=False
        )

        pd.DataFrame(all_metrics).to_sql(
            "product_forecast_metrics",
            engine,
            if_exists="replace",
            index=False
        )

    print("Product forecasting completed.")

# ==================================================
# MAIN PIPELINE
# ==================================================
def process_and_store_data(file_path):

    # --------------------------------------------------
    # 1. Load & Clean Data
    # --------------------------------------------------
    df = pd.read_csv(file_path)

    df["order_date"] = pd.to_datetime(df["order_date"], errors="coerce", dayfirst=True)
    df = df.dropna(subset=["order_date"])
    df = df.sort_values("order_date")

    # --------------------------------------------------
    # 2. PRODUCT FORECASTING
    # --------------------------------------------------
    product_level_forecasting(df)

    # --------------------------------------------------
    # 3. RFM Analysis
    # --------------------------------------------------
    current_date = df["order_date"].max()

    rfm = (
        df.groupby("customer_id")
        .agg({
            "order_date": lambda x: (current_date - x.max()).days,
            "order_no": "count",
            "sales": "sum"
        })
        .rename(columns={
            "order_date": "Recency",
            "order_no": "Frequency",
            "sales": "Monetary"
        })
        .reset_index()
    )

    scaler = StandardScaler()
    rfm_scaled = scaler.fit_transform(rfm[["Recency", "Frequency", "Monetary"]])

    kmeans = KMeans(n_clusters=4, n_init=10, random_state=42)
    rfm["Segment"] = kmeans.fit_predict(rfm_scaled)

    segment_order = (
        rfm.groupby("Segment")["Monetary"]
        .mean()
        .sort_values(ascending=False)
        .index
        .tolist()
    )

    labels = ["High Value", "Mid Value", "Low Value", "Churn Risk"]
    segment_map = dict(zip(segment_order, labels))
    rfm["Segment_Label"] = rfm["Segment"].map(segment_map)

    # --------------------------------------------------
    # 4. OVERALL SALES FORECAST
    # --------------------------------------------------

    monthly_sales = (
        df.set_index("order_date")
        .resample("MS")["sales"]
        .sum()
        .reset_index()
        .rename(columns={"order_date": "ds", "sales": "y"})
    )

    monthly_sales["y"] = np.log1p(monthly_sales["y"])
    
    # Train-test split (last 12 months as test)
    train = monthly_sales[:-12]
    test = monthly_sales[-12:]

    model = Prophet(
        yearly_seasonality=True,
        seasonality_mode="multiplicative",
        changepoint_prior_scale=0.2
    )

    model.fit(train)

    future = model.make_future_dataframe(periods=12, freq="MS")
    forecast = model.predict(future)

    # Get predictions for test period
    predicted = forecast.tail(12)["yhat"].values
    actual = test["y"].values

    # SMAPE function (inside the main function)
    def smape(actual, predicted):
        return np.mean(
            2 * np.abs(predicted - actual) /
            (np.abs(actual) + np.abs(predicted))
        ) * 100

    smape_value = smape(actual, predicted)
    forecast_accuracy = round(100 - smape_value, 2)

    # --------------------------------------------------
    # Retrain on full data for final forecast
    # --------------------------------------------------

        # --------------------------------------------------
    # Retrain on full data for final forecast
    # --------------------------------------------------

    final_model = Prophet(
        yearly_seasonality=True,
        seasonality_mode="additive",
        changepoint_prior_scale=0.1
    )

    final_model.fit(monthly_sales)

    future_12 = final_model.make_future_dataframe(periods=12, freq="MS")
    forecast_full = final_model.predict(future_12)
    
    # ✅ Convert predictions back to original scale
    forecast_full["yhat"] = np.expm1(forecast_full["yhat"])
    forecast_full["yhat_lower"] = np.expm1(forecast_full["yhat_lower"])
    forecast_full["yhat_upper"] = np.expm1(forecast_full["yhat_upper"])

    # --------------------------------------------------
    # OPTION 1: Filter Only Year 2014 (Jan → Dec)
    # --------------------------------------------------

    forecast_2014 = forecast_full[
        (forecast_full["ds"] >= "2014-01-01") &
        (forecast_full["ds"] <= "2014-12-01")
    ][[
        "ds", "yhat", "yhat_lower", "yhat_upper"
    ]].rename(columns={
        "ds": "forecast_month",
        "yhat": "predicted_sales",
        "yhat_lower": "lower_ci",
        "yhat_upper": "upper_ci"
    })

    accuracy_df = pd.DataFrame({
        "forecast_accuracy": [forecast_accuracy]
    })

    # --------------------------------------------------
    # 5. Save to Database
    # --------------------------------------------------
    rfm.to_sql("customer_segments", engine, if_exists="replace", index=False)
    forecast_2014.to_sql("sales_forecast", engine, if_exists="replace", index=False)
    accuracy_df.to_sql("forecast_metrics", engine, if_exists="replace", index=False)

    print("✅ ML pipeline executed successfully")
