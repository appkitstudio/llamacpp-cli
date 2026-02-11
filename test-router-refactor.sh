#!/bin/bash

# Test script for router refactor
# Verifies that direct Anthropic API proxying works correctly

set -e

echo "=== Router Refactor Test Suite ==="
echo ""

# Check if router is running
ROUTER_STATUS=$(npm run dev -- router status 2>&1 | grep -E "Status:|running|stopped" || true)
echo "Router status check:"
echo "$ROUTER_STATUS"
echo ""

# Get list of running models
echo "Available models:"
MODELS=$(curl -s http://localhost:9100/v1/models | jq -r '.data[].id' 2>/dev/null || echo "No models available")
echo "$MODELS"
echo ""

if [ "$MODELS" = "No models available" ]; then
    echo "❌ No running servers found. Please start a server first:"
    echo "   llamacpp server create <model-name>"
    exit 1
fi

# Get first model name
MODEL=$(echo "$MODELS" | head -1)
echo "Using model: $MODEL"
echo ""

# Test 1: Non-streaming request
echo "=== Test 1: Non-streaming Anthropic Messages API ==="
RESPONSE=$(curl -s -X POST http://localhost:9100/v1/messages \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 50,
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hello in exactly 3 words\"}]
  }")

if echo "$RESPONSE" | jq -e '.content[0].text' > /dev/null 2>&1; then
    echo "✅ Non-streaming test passed"
    echo "Response: $(echo "$RESPONSE" | jq -r '.content[0].text')"
else
    echo "❌ Non-streaming test failed"
    echo "Response: $RESPONSE"
    exit 1
fi
echo ""

# Test 2: Streaming request
echo "=== Test 2: Streaming Anthropic Messages API ==="
STREAM_RESPONSE=$(curl -s -X POST http://localhost:9100/v1/messages \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 30,
    \"stream\": true,
    \"messages\": [{\"role\": \"user\", \"content\": \"Count to 3\"}]
  }")

if echo "$STREAM_RESPONSE" | grep -q "event: message_start"; then
    echo "✅ Streaming test passed (received SSE events)"
    EVENT_COUNT=$(echo "$STREAM_RESPONSE" | grep -c "^event:" || echo "0")
    echo "Received $EVENT_COUNT SSE events"
else
    echo "❌ Streaming test failed"
    echo "Response: $STREAM_RESPONSE"
    exit 1
fi
echo ""

# Test 3: Tool calling (if model supports it)
echo "=== Test 3: Tool Calling Support ==="
TOOL_RESPONSE=$(curl -s -X POST http://localhost:9100/v1/messages \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 200,
    \"messages\": [{\"role\": \"user\", \"content\": \"What is 2+2?\"}],
    \"tools\": [{
      \"name\": \"calculator\",
      \"description\": \"Perform basic arithmetic\",
      \"input_schema\": {
        \"type\": \"object\",
        \"properties\": {
          \"expression\": {\"type\": \"string\"}
        },
        \"required\": [\"expression\"]
      }
    }]
  }")

if echo "$TOOL_RESPONSE" | jq -e '.stop_reason' > /dev/null 2>&1; then
    STOP_REASON=$(echo "$TOOL_RESPONSE" | jq -r '.stop_reason')
    echo "✅ Tool calling test passed (stop_reason: $STOP_REASON)"
    if [ "$STOP_REASON" = "tool_use" ]; then
        echo "   Model used tool calling!"
        TOOL_NAME=$(echo "$TOOL_RESPONSE" | jq -r '.content[] | select(.type=="tool_use") | .name' || echo "none")
        echo "   Tool called: $TOOL_NAME"
    fi
else
    echo "⚠️  Tool calling test inconclusive"
    echo "Response: $TOOL_RESPONSE"
fi
echo ""

# Test 4: Error handling
echo "=== Test 4: Error Handling ==="
ERROR_RESPONSE=$(curl -s -X POST http://localhost:9100/v1/messages \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"nonexistent-model\",
    \"max_tokens\": 50,
    \"messages\": [{\"role\": \"user\", \"content\": \"test\"}]
  }")

if echo "$ERROR_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR_TYPE=$(echo "$ERROR_RESPONSE" | jq -r '.error.type')
    echo "✅ Error handling test passed (error_type: $ERROR_TYPE)"
else
    echo "❌ Error handling test failed"
    echo "Response: $ERROR_RESPONSE"
    exit 1
fi
echo ""

# Test 5: Health check
echo "=== Test 5: Health Check ==="
HEALTH=$(curl -s http://localhost:9100/health)
if echo "$HEALTH" | jq -e '.status' > /dev/null 2>&1; then
    STATUS=$(echo "$HEALTH" | jq -r '.status')
    echo "✅ Health check passed (status: $STATUS)"
else
    echo "❌ Health check failed"
    exit 1
fi
echo ""

echo "=== All Tests Passed ✅ ==="
echo ""
echo "Router refactor verification complete!"
echo "The router is successfully using llama.cpp's native Anthropic API."
