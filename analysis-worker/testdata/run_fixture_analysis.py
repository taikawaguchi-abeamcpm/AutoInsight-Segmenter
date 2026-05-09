import csv
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TESTDATA = Path(__file__).resolve().parent
WORKER_PATH = ROOT / "analysis-worker" / "autoinsight_analysis" / "worker.py"


def load_csv(name: str) -> list[dict[str, str]]:
    with (TESTDATA / name).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    spec = importlib.util.spec_from_file_location("worker", WORKER_PATH)
    worker = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(worker)

    rows_by_table = {
        "customers": load_csv("customers.csv"),
        "activities": load_csv("activities.csv"),
        "sales": load_csv("sales.csv"),
    }

    def fetch_table_rows(connection, auth, table_name, column_names, page_size=None, max_rows=None):
        rows = rows_by_table.get(table_name, [])
        selected = [
            {column_name: row.get(column_name) for column_name in column_names if column_name}
            for row in rows
        ]
        return {"rows": selected, "truncated": False}

    worker.fetch_table_rows = fetch_table_rows

    with (TESTDATA / "payload.json").open(encoding="utf-8") as handle:
        payload = json.load(handle)

    result = worker.build_real_analysis_result(payload)
    output_path = TESTDATA / "analysis-result.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": result.get("status"),
        "summary": result.get("summary"),
        "topFeatures": result.get("featureImportances", [])[:8],
        "topPatterns": result.get("goldenPatterns", [])[:5],
        "resultPath": str(output_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
