"""Background scheduler inside the API process (runs while uvicorn runs).

Every minute: send the report packs that are due. Every hour (and right after the nightly reconciliation):
evaluate the alerts. Once a night at the configured hour: reconcile D365 with the reporting database.
"""
import threading
import time
from datetime import datetime

_started = False


def start(log, pack_due, nightly_recon, evaluate_alerts):
    global _started
    if _started:
        return
    _started = True

    def loop():
        last_alerts = 0.0
        time.sleep(30)                                   # let the API finish starting
        while True:
            now = datetime.now()
            for name, job in (("report pack", pack_due), ("reconciliation", nightly_recon)):
                try:
                    if job(now) and name == "reconciliation":
                        last_alerts = 0                  # re-check alerts right after a reconciliation
                except Exception as ex:                  # noqa: BLE001 - never stop the loop
                    log.warning("scheduler: %s failed: %s", name, str(ex).splitlines()[0][:300])
            if time.time() - last_alerts > 3600:
                try:
                    evaluate_alerts()
                except Exception as ex:                  # noqa: BLE001
                    log.warning("scheduler: alerts failed: %s", str(ex).splitlines()[0][:300])
                last_alerts = time.time()
            time.sleep(60 - datetime.now().second)

    threading.Thread(target=loop, name="report-scheduler", daemon=True).start()
    log.info("startup - scheduler started (report packs, nightly reconciliation, hourly alerts)")
