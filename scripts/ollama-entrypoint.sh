#!/bin/bash
set -e

# 1. Start Ollama server in background
ollama serve &
OLLAMA_PID=$!

# Forward signals for graceful shutdown
trap "kill $OLLAMA_PID; wait $OLLAMA_PID" SIGTERM SIGINT

# 2. Wait for Ollama to be ready (max 60s)
echo "Waiting for Ollama to start..."
READY=false
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" = false ]; then
  echo "ERROR: Ollama failed to start within 60 seconds."
  exit 1
fi

# 3. Check if models already loaded (persisted volume)
MODEL_COUNT=$(ollama list 2>/dev/null | tail -n +2 | wc -l)

if [ "$MODEL_COUNT" = "0" ]; then
  echo "No models found. Detecting hardware..."

  # 4. Runtime GPU detection
  GPU_DETECTED=false
  if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    GPU_DETECTED=true
    echo "GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'unknown')"
  fi

  # 5. Pull appropriate default model
  if [ "$GPU_DETECTED" = true ]; then
    echo "Pulling llama3:8b (GPU-optimized default)..."
    ollama pull llama3:8b
  else
    echo "Pulling phi3:mini (CPU-optimized default)..."
    ollama pull phi3:mini
  fi

  echo "Default model ready."
else
  echo "$MODEL_COUNT model(s) already available."
fi

# 6. Foreground the Ollama process
wait $OLLAMA_PID
