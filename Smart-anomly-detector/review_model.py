import pandas as pd
import numpy as np
import joblib
import os
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, confusion_matrix

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")

# ==========================
# 2. Load Dataset
# ==========================
# CSV should have columns: "review","label"

data_path = os.path.join(DATA_DIR, "reviews_reports.csv")
df = pd.read_csv(data_path)

print("Sample Data:")
print(df.head())

# ==========================
# 3. Train/Test Split
# ==========================
X = df["review"]
y = df["label"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# ==========================
# 4. Build Pipeline
# ==========================
# TF-IDF -> Logistic Regression
pipeline = Pipeline([
    ("tfidf", TfidfVectorizer(stop_words="english", max_features=5000, ngram_range=(1,2))),
    ("clf", LogisticRegression(max_iter=200, class_weight="balanced"))
])

# ==========================
# 5. Train Model
# ==========================
pipeline.fit(X_train, y_train)

# ==========================
# 6. Evaluate
# ==========================
y_pred = pipeline.predict(X_test)

print("\nClassification Report:")
print(classification_report(y_test, y_pred))

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))

# ==========================
# 7. Save Model
# ==========================
model_dir = os.path.join(BASE_DIR, "model")
os.makedirs(model_dir, exist_ok=True)
model_path = os.path.join(model_dir, "threat_classifier.pkl")
joblib.dump(pipeline, model_path)
print(f"✅ Model saved to {model_path}")
