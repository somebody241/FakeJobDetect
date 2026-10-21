from pathlib import Path
import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score # precision, share of real scams that are predicted as scams; recall, share of predicted scams that are real scams; roc_auc, area under the ROC curve
from sklearn.model_selection import StratifiedKFold
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

DATA_PATH = Path(__file__).with_name("data.csv")
MODEL_PATH = Path(__file__).with_name("model.joblib")
SALARY = ["salary_min", "salary_max"]
# Kept in proekt.ipynb after dropping every column with correlation under 0.2.
FEATURES = [
    "salary_min",
    "salary_max",
    "required_experience_years",
    "skills_listed",
    "allcaps_ratio",
    "posting_hour",
    "company_age_months",
    "company_size",
    "mentions_trial_or_payment",
]

def load_reviews(path=DATA_PATH):
    return pd.read_csv(path)


def encode(df, medians=None, columns=None):
    """Keep the notebook's nine features. Empty salaries are filled with the training median."""
    frame = df.reindex(columns=columns or FEATURES).copy()
    if medians is None:
        medians = frame[SALARY].median()
    frame[SALARY] = frame[SALARY].fillna(medians)
    return frame, medians


class ReviewModel:
    def __init__(self, reviews):
        encoded, self.medians = encode(reviews)
        self.columns = list(encoded.columns)
        self.scaler = StandardScaler().fit(encoded)
        scaled = self._scaled(encoded)
        self.clf = LogisticRegression(class_weight="balanced", max_iter=1000).fit(
            scaled, reviews["scam"]
        )
        self.neighbors = NearestNeighbors(n_neighbors=3).fit(scaled)
        self.reviews = reviews

    def _scaled(self, encoded):
        scaled = encoded.astype(float)
        scaled[list(encoded.columns)] = self.scaler.transform(encoded)
        return scaled

    def score(self, posting):
        encoded, _ = encode(posting, self.medians, self.columns)
        scaled = self._scaled(encoded)
        verdict = int(self.clf.predict(scaled)[0])
        probability = float(self.clf.predict_proba(scaled)[0, 1])
        distances, indices = self.neighbors.kneighbors(scaled)
        closest = self.reviews.iloc[indices[0]].copy()
        closest.insert(0, "distance", distances[0])
        return verdict, probability, closest

    def save(self, path=MODEL_PATH):
        joblib.dump(
            {
                "clf": self.clf,
                "scaler": self.scaler,
                "neighbors": self.neighbors,
                "medians": self.medians,
                "columns": self.columns,
                "reviews": self.reviews,
                "scores": self.scores,
            },
            path,
        )

    @staticmethod
    def load(path=MODEL_PATH):
        blob = joblib.load(path)
        model = ReviewModel.__new__(ReviewModel)
        model.clf = blob["clf"]
        model.scaler = blob["scaler"]
        model.neighbors = blob["neighbors"]
        model.medians = blob["medians"]
        model.columns = blob["columns"]
        model.reviews = blob["reviews"]
        model.scores = blob["scores"]
        return model


def evaluate(df, quiet=False):
    """Score five held-out folds. Returns the mean of each metric."""
    y = df["scam"].to_numpy()
    folds = StratifiedKFold(5, shuffle=True, random_state=42)
    scores = {"roc_auc": [], "recall": [], "precision": [], "accuracy": []}
    for train_idx, test_idx in folds.split(df, y):
        model = ReviewModel(df.iloc[train_idx])
        encoded, _ = encode(df.iloc[test_idx], model.medians, model.columns)
        proba = model.clf.predict_proba(model._scaled(encoded))[:, 1]
        pred = (proba >= 0.5).astype(int)
        actual = y[test_idx]
        scores["roc_auc"].append(roc_auc_score(actual, proba))
        scores["recall"].append(recall_score(actual, pred, zero_division=0))
        scores["precision"].append(precision_score(actual, pred, zero_division=0))
        scores["accuracy"].append(accuracy_score(actual, pred))
    means = {}
    for name, values in scores.items():
        means[name] = sum(values) / len(values)
        if not quiet:
            folded = ", ".join(f"{value:.3f}" for value in values)
            print(f"5-fold {name}: {folded}  mean {means[name]:.3f}")
    return means


def main():
    reviews = load_reviews()
    print(f"reviewed postings: {len(reviews)}, scam rate: {reviews['scam'].mean():.3f}")
    model = ReviewModel(reviews)
    model.scores = evaluate(reviews)
    model.save()
    print(f"saved {MODEL_PATH.name}")
    example = pd.DataFrame(
        [
            {
                "salary_min": None,
                "salary_max": None,
                "required_experience_years": 1.0,
                "skills_listed": 4,
                "allcaps_ratio": 0.18,
                "posting_hour": 2,
                "company_age_months": 2,
                "company_size": 3,
                "mentions_trial_or_payment": 1,
            }
        ]
    )
    verdict, probability, closest = model.score(example)
    label = "scam" if verdict == 1 else "legitimate"
    print(f"example posting: {label}, scam probability {probability:.3f}")
    print(closest[["distance", "skills_listed", "company_age_months", "allcaps_ratio", "scam"]].to_string(index=False))


if __name__ == "__main__":
    main()
