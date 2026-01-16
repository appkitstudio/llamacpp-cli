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

# Main loop - continuously send requests
while true; do
  # Run 3 requests in parallel
  for i in {1..3}; do
    # Randomly select port and prompt
    PORT=${PORTS[$RANDOM % ${#PORTS[@]}]}
    PROMPT=${PROMPTS[$RANDOM % ${#PROMPTS[@]}]}

    ((REQUEST_COUNT++))

    # Run in background for parallel execution
    run_chat "$PORT" "$PROMPT" "$REQUEST_COUNT" &
  done

  # Wait for current batch to complete before starting next
  wait

  # Small delay between batches to avoid overwhelming the system
  sleep 2
done
