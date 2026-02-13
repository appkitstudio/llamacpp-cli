#!/bin/bash

# Router Traffic Generator
# Usage: ./router-traffic.sh [parallel_requests]
# Example: ./router-traffic.sh 4    # Run 4 requests in parallel
# Press Ctrl+C to stop

ROUTER_URL="http://127.0.0.1:9100"
PARALLEL=${1:-1}  # Default to 1 if not specified

# Array of models
MODELS=(
  "llama-3.2-3b-instruct-q4_k_m.gguf"
  "LiquidAI_LFM2-2.6B-Exp-Q5_K_M.gguf"
  "LFM2.5-1.2B-Instruct-BF16.gguf"  # Port 9000
  "nonexistent-model"  # Will generate 404 errors
)

# Array of prompts (longer ones to keep slots busy for monitor visibility)
PROMPTS=(
  "Write a detailed story about a robot learning to paint"
  "Explain how photosynthesis works in detail"
  "Describe the process of making bread from scratch"
  "Tell me about the history of computers in 3 paragraphs"
  "Write a creative poem about the ocean"
  "Explain quantum mechanics to a 10 year old"
  "Describe a day in the life of an astronaut"
  "Write a short mystery story with a twist ending"
  "Explain how a car engine works step by step"
  "Tell me about the solar system and its planets"
)

echo "╔════════════════════════════════════════╗"
echo "║   Router Traffic Generator Started    ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Sending requests to: $ROUTER_URL"
echo "Parallel requests: $PARALLEL"
echo "Press Ctrl+C to stop"
echo ""

REQUEST_COUNT=0
declare -a PIDS=()

# Handle Ctrl+C gracefully
cleanup() {
  echo ""
  echo ""
  echo "Stopping traffic..."
  # Kill all background jobs
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  echo "Traffic stopped. Total requests sent: $REQUEST_COUNT"
  exit 0
}

trap cleanup INT TERM

# Function to send a single request
send_request() {
  local count=$1
  local model=${MODELS[$RANDOM % ${#MODELS[@]}]}
  local prompt=${PROMPTS[$RANDOM % ${#PROMPTS[@]}]}
  local max_tokens=$((200 + RANDOM % 300))

  echo -n "[$count] → $model | \"${prompt:0:40}...\" ... "

  local http_code=$(curl -s -o /tmp/router-response-$count.json -w "%{http_code}" "$ROUTER_URL/v1/messages" \
    -H "Content-Type: application/json" \
    -d "{\"model\": \"$model\", \"max_tokens\": $max_tokens, \"messages\": [{\"role\": \"user\", \"content\": \"$prompt\"}]}")

  if [ "$http_code" = "200" ]; then
    echo -e "\033[32m$http_code OK\033[0m"
  else
    echo -e "\033[31m$http_code ERROR\033[0m"
  fi
}

while true; do
  # Pick random model and prompt
  MODEL=${MODELS[$RANDOM % ${#MODELS[@]}]}
  PROMPT=${PROMPTS[$RANDOM % ${#PROMPTS[@]}]}
  MAX_TOKENS=$((200 + RANDOM % 300))  # Random between 200-500 (takes 10-30s to complete)

  # Maintain N parallel requests
  # Clean up completed background jobs
  PIDS=($(jobs -p))

  # If we have fewer than PARALLEL requests running, send more
  while [ ${#PIDS[@]} -lt $PARALLEL ]; do
    REQUEST_COUNT=$((REQUEST_COUNT + 1))
    send_request $REQUEST_COUNT &
    PIDS+=($!)

    # Small delay between starting parallel requests
    sleep 0.5
  done

  # Wait a bit before checking again
  sleep 2
done
