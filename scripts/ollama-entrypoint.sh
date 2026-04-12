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
  if ollama list > /dev/null 2>&1; then
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

  # 4. Detect GPU and VRAM
  VRAM_MB=0
  if command -v nvidia-smi > /dev/null 2>&1 && nvidia-smi > /dev/null 2>&1; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo "unknown")
    VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null || echo "0")
    echo "GPU detected: $GPU_NAME (${VRAM_MB}MB VRAM)"
  else
    echo "No GPU detected — will use CPU."
  fi

  # 5. Detect system RAM
  TOTAL_RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
  echo "System RAM: ${TOTAL_RAM_MB}MB"

  # 6. Select model — use installer's choice if provided, else auto-detect.
  #    OLLAMA_DEFAULT_MODEL is set by install-dpf.ps1 via SELECTED_MODEL in .env.
  #    Picks the largest Gemma 4/3 variant that fits available hardware.
  if [ -n "$OLLAMA_DEFAULT_MODEL" ]; then
    MODEL="$OLLAMA_DEFAULT_MODEL"
    echo "Using installer-selected model: $MODEL"
  elif [ "$VRAM_MB" -ge 20000 ]; then
    MODEL="gemma4:27b"
    echo "Selecting gemma4:27b — fits in ${VRAM_MB}MB VRAM"
  elif [ "$VRAM_MB" -ge 8000 ]; then
    MODEL="gemma3:12b"
    echo "Selecting gemma3:12b — fits in ${VRAM_MB}MB VRAM"
  elif [ "$VRAM_MB" -ge 4000 ]; then
    MODEL="gemma3:4b"
    echo "Selecting gemma3:4b — fits in ${VRAM_MB}MB VRAM"
  elif [ "$TOTAL_RAM_MB" -ge 16000 ]; then
    MODEL="gemma3:4b"
    echo "Selecting gemma3:4b — no GPU, using ${TOTAL_RAM_MB}MB system RAM"
  elif [ "$TOTAL_RAM_MB" -ge 8000 ]; then
    MODEL="gemma3:1b"
    echo "Selecting gemma3:1b — no GPU, using ${TOTAL_RAM_MB}MB system RAM"
  else
    MODEL="gemma3:1b"
    echo "Selecting gemma3:1b — constrained hardware (${TOTAL_RAM_MB}MB RAM)"
  fi

  echo "Pulling $MODEL..."
  ollama pull "$MODEL"
  echo "Default model ready: $MODEL"

  # Always pull the embedding model for semantic memory (small, ~274MB)
  echo "Pulling nomic-embed-text (embedding model for agent memory)..."
  ollama pull nomic-embed-text
  echo "Embedding model ready: nomic-embed-text"
else
  echo "$MODEL_COUNT model(s) already available:"
  ollama list

  # Ensure embedding model is available (may not be if upgrading from older install)
  if ! ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    echo "Pulling nomic-embed-text (embedding model for agent memory)..."
    ollama pull nomic-embed-text
  fi
fi

# 7. Foreground the Ollama process
wait $OLLAMA_PID
