#!/bin/bash
# HTTP log filter wrapper
# Usage: ./http-log-filter.sh <node-path> <filter-script-path>

NODE_PATH="$1"
FILTER_SCRIPT="$2"

"${NODE_PATH}" "${FILTER_SCRIPT}"
