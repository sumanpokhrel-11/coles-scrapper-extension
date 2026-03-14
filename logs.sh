#!/bin/bash

ACCESS_LOG="/var/log/nginx/cgios.access.log"
ERROR_LOG="/var/log/nginx/cgios.error.log"

if [ "$1" == "clear" ]; then
    sudo truncate -s 0 "$ACCESS_LOG"
    sudo truncate -s 0 "$ERROR_LOG"
    echo "✅ Logs cleared."
    exit 0
fi

# Use argument 1, default to 10 if empty
NUM_LINES=${1:-10}

echo -e "\n===== cgios.access.log ====="
sudo tail -n "$NUM_LINES" "$ACCESS_LOG"

echo -e "\n===== cgios.error.log ====="
sudo tail -n "$NUM_LINES" "$ERROR_LOG"

echo -e "\n===== journalctl cgios_api ====="
sudo journalctl -u cgios_api -n 50 --no-pager
