#!/bin/bash

# Test script for parallel chat requests to multiple llama servers
# Usage: ./test-load.sh
# Stop with CTRL-C

set -e

# Available ports
PORTS=(9001 9002 9004 9005)

# Test prompts with varying complexity
PROMPTS=(
  "Write a hello world program in Python"
  "Explain quantum computing in simple terms"
  "Write a flappy bird game in Python"
  "What are the benefits of functional programming?"
  "Create a REST API example using FastAPI"
  "Explain the difference between processes and threads"
  "Write a binary search algorithm in JavaScript"
  "What is the difference between HTTP and HTTPS?"
  "Create a simple todo list app in React"
  "Explain Docker containers to a beginner"
  "Write a quicksort implementation in C++"
  "What are the SOLID principles?"
  "Create a SQL query to find duplicate records"
  "Explain async/await in JavaScript"
  "Write a Fibonacci sequence generator in any language"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counter for requests
REQUEST_COUNT=0

# Function to run a single chat request
run_chat() {
  local port=$1
  local prompt=$2
  local request_id=$3

  echo -e "${CYAN}[Request #${request_id}]${NC} ${YELLOW}Port ${port}:${NC} ${prompt}"

  # Run the chat request (suppress output except errors)
  if npm run dev -- server run -m "$prompt" "$port" > /dev/null 2>&1; then
    echo -e "${CYAN}[Request #${request_id}]${NC} ${GREEN}✓ Completed${NC} (port ${port})"
  else
    echo -e "${CYAN}[Request #${request_id}]${NC} ${RED}✗ Failed${NC} (port ${port})"
  fi
}

# Trap CTRL-C for clean exit
trap 'echo -e "\n${YELLOW}Stopping test load script...${NC}"; echo -e "${GREEN}Total requests sent: ${REQUEST_COUNT}${NC}"; exit 0' INT

echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  Llama Server Load Test${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo -e "${BLUE}Ports: ${PORTS[*]}${NC}"
echo -e "${BLUE}Parallel requests: 3${NC}"
echo -e "${BLUE}Press CTRL-C to stop${NC}"
echo -e "${MAGENTA}========================================${NC}\n"

# Function to count running background jobs
count_running_jobs() {
  jobs -r | wc -l | tr -d ' '
}

# Main loop - maintain exactly 3 concurrent requests at all times
# Start initial 3 requests
for i in {1..3}; do
  PORT=${PORTS[$RANDOM % ${#PORTS[@]}]}
  PROMPT=${PROMPTS[$RANDOM % ${#PROMPTS[@]}]}
  ((REQUEST_COUNT++))
  run_chat "$PORT" "$PROMPT" "$REQUEST_COUNT" &
done

# Continuously monitor and start new requests as old ones complete
while true; do
  # Get count of running background jobs
  RUNNING=$(count_running_jobs)

  # Start new requests to maintain 3 concurrent
  while [ "$RUNNING" -lt 3 ]; do
    PORT=${PORTS[$RANDOM % ${#PORTS[@]}]}
    PROMPT=${PROMPTS[$RANDOM % ${#PROMPTS[@]}]}
    ((REQUEST_COUNT++))
    run_chat "$PORT" "$PROMPT" "$REQUEST_COUNT" &
    RUNNING=$(count_running_jobs)
  done

  # Small sleep to avoid busy-waiting
  sleep 0.5
done
