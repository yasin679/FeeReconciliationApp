#!/bin/bash
# rebuild front-end + server, restart with clean data
cd /home/claude/frd/ui && cat core.js views.js workflow.js acs.js modals.js events.js > app.js && node --check app.js && node --check engine.js || exit 1
cp index.html app.css engine.js app.js /home/claude/frd/src/FeeReconDesk/wwwroot/
kill $(pgrep -f '^dotnet FeeReconDesk.dll') 2>/dev/null; sleep 1
cd /home/claude/frd/src/FeeReconDesk && timeout 300 dotnet publish -c Release -o /home/claude/frd/out > /tmp/pub.log 2>&1 || { grep -E "error" /tmp/pub.log | sort -u | head; exit 1; }
cd /home/claude/frd/out && rm -rf data
(FRD_ADMIN_PASSWORD='Admin#Pass2026' LoginAttemptsPerMinute=${LPM:-1000} setsid nohup dotnet FeeReconDesk.dll > /home/claude/frd/server.log 2>&1 &)
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null http://localhost:5090/api/csrf && break; done
grep -E "demo password|listening" /home/claude/frd/server.log
