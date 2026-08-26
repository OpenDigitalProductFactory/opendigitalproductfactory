# Choosing Hardware for DPF

*Market availability reviewed August 24, 2026. Product configurations, prices,
and regional stock change frequently; follow the manufacturer links before
ordering.*

DPF has two customer deployment models:

1. **Provider-assisted** — the DPF application and business data run on the
   organization's machine, while approved AI requests use an external model
   provider.
2. **Local-first** — the DPF application, business data, and primary language
   model run on the organization's machine. A provider can still be configured
   as an explicit fallback for work the local model is not qualified to do.

Platform development is a separate workload. A customer should not have to buy
a coding workstation to run day-to-day operations.

After choosing the host, continue with the [Windows](windows.md),
[macOS](macos.md), [Linux early-access](linux.md), or
[single-VM cloud](cloud-single-vm.md) installation guide.

## The short recommendation

| Profile | Recommended configuration and use |
| --- | --- |
| Provider-assisted operations | **8–12 modern CPU cores · 32 GB RAM · 1 TB NVMe SSD · no discrete GPU required.** Choose 64 GB for heavy browser or document work. This profile handles routine operations with approved external AI providers. |
| Local-first operations, discrete GPU | **12–16 modern CPU cores · 64 GB system RAM · 2 TB NVMe SSD · 24 GB VRAM supported; 32 GB recommended for a new purchase.** This profile handles local tool-using coworkers at 32K context, with modest headroom for voice or another AI service. |
| Local-first operations, Apple unified memory | **Apple Silicon · 2 TB SSD · 64 GB unified memory practical; 128 GB recommended when the host must run larger local models or double as a development machine.** This profile can run larger local models and longer context without a separate VRAM ceiling. |
| Contributor/development workstation | **16–24 modern CPU cores · 128 GB memory · 4 TB NVMe SSD · 32 GB VRAM or 128 GB unified memory.** This profile adds capacity for source work, worktrees, builds, tests, browser automation, and local model evaluation. |

The customer profiles exclude Build Studio, local coding-model capacity, source
worktrees, and build workers. Those belong to a customizable contributor
installation or an external development environment.

## Machines available now

These are representative, manufacturer-direct configurations available in the
United States when this guide was reviewed. They are examples, not exclusive
endorsements or DPF certifications. Match the specification rather than the
logo, and include the warranty and on-site support appropriate for the
organization.

### Provider-assisted operations

| Representative machine | Configuration to look for | Why it fits |
| --- | --- | --- |
| [HP EliteDesk 8 Mini](https://www.hp.com/us-en/shop/vwa/desktops/opsy%3DWindows-11-Pro%26brand%3DEliteDesk) | Windows 11 Pro, 32 GB RAM, 1 TB SSD | Compact business desktop with no unnecessary discrete-GPU cost |
| [Dell Pro Tower](https://www.dell.com/en-us/shop/desktop-computers/dell-pro-tower-desktop/spd/dell-pro-qct1250-desktop/gcto_qct1250_usx) | Windows 11 Pro, 32 GB RAM, 1 TB SSD | Conventional, serviceable business tower |
| [Apple Mac mini with M4 Pro](https://www.apple.com/shop/buy-mac/mac-mini/m4-pro-chip-12-core-cpu-16-core-gpu-48gb-memory-1tb-storage) | 48–64 GB unified memory, 1 TB SSD | Quiet, compact host that can also run a useful local model when needed |

There is little benefit in buying a large GPU for this deployment unless the
organization expects to move primary inference on-site later.

### Local-first Windows with NVIDIA

| Representative machine | Configuration available | Buying note |
| --- | --- | --- |
| [HP OMEN MAX 45L](https://www.hp.com/us-en/shop/pdp/omen-max-45l-gaming-dt-gt23-0990m-pc-ck4n6aa-aba) | Windows 11 Pro, Ryzen 9, 64 GB RAM, 4 TB SSD, RTX 5090 32 GB | Closely matches the recommended operational profile; add business-grade support |
| [Dell Alienware Area-51](https://www.dell.com/en-us/shop/desktop-computers/alienware-area-51-gaming-desktop/spd/alienware-area-51-aat2250-gaming-desktop/useaat2250hbtshtrd) | Core Ultra 9, 64 GB RAM, 4 TB SSD, RTX 5090 32 GB | Turnkey 5090 tower with configurable support; physically large and power-hungry |
| [Puget Systems custom workstation](https://www.pugetsystems.com/products/workstations/configure) | Configure 64–128 GB RAM, 2–4 TB NVMe, RTX 5090 32 GB | Better fit when professional integration and workload-specific support matter more than gaming branding |

NVIDIA specifies 32 GB GDDR7, 575 W total graphics power, and a 1,000 W
reference system-power requirement for the RTX 5090. Check the actual system's
power supply, cooling, clearances, warranty, and electrical circuit rather than
assuming every 5090 tower is equivalent. See [NVIDIA's RTX 5090
specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/).

An existing RTX 4090 with 24 GB remains a capable DPF machine. It is not a
reason to upgrade by itself. The 32 GB 5090 recommendation is for a new purchase
because the extra 8 GB provides useful context and service headroom; it does not
make the same model more knowledgeable.

### Local-first Apple unified memory

| Representative machine | Configuration available | Buying note |
| --- | --- | --- |
| [MacBook Pro with M5 Max](https://www.apple.com/macbook-pro/specs/) | Up to 128 GB unified memory and 8 TB SSD | Best portable option; 128 GB is already an effective DPF operations-and-development machine |
| [Mac Studio](https://www.apple.com/shop/buy-mac/mac-studio/) | M4 Max up to 128 GB; M3 Ultra up to 512 GB unified memory | Best fixed Apple host; choose 128 GB for DPF unless a demonstrated larger-model workload justifies more |
| [Mac mini with M4 Pro](https://support.apple.com/en-us/121555) | Up to 64 GB unified memory and 8 TB SSD | Lower-cost local-first entry for one operator and a smaller operational model |

Apple Silicon is a generally available DPF install surface. See the [macOS
installation guide](macos.md). Memory cannot be upgraded after purchase, so buy
for the expected model and useful life rather than today's minimum.

## Why unified memory changes the calculation

A conventional NVIDIA workstation has two memory pools:

- **System RAM** holds Windows, Docker, the DPF services, model mappings, browser
  work, and development tools.
- **VRAM** holds the actively offloaded model, context cache, and GPU compute
  buffers.

Putting a model in VRAM therefore does not eliminate its system-RAM footprint.
It also means a 64 GB Windows workstation with a 32 GB GPU cannot present all 96
GB as one model-memory pool.

Apple Silicon lets the CPU and GPU share one high-bandwidth pool. DPF reserves
25% of unified memory for macOS and the application stack, leaving a planning
budget of approximately 48 GB on a 64 GB Mac and 96 GB on a 128 GB Mac. That is
why a 128 GB Mac can load models that do not fit a 32 GB graphics card.

Unified capacity is not the same as speed. The RTX 5090 has much higher graphics
memory bandwidth and usually generates tokens faster when the entire model fits
in 32 GB. Apple unified memory trades some peak inference speed for a much
larger flexible memory pool, quiet operation, and excellent performance per
watt. The right choice is therefore:

- **NVIDIA 32 GB** when low latency and CUDA compatibility matter most.
- **Apple 128 GB** when larger models, long context, portability, or a combined
  operations-and-development machine matter most.

## Model and context sizing

Customer hardware should be sized for a tool-using operational model, not a
coding benchmark. DPF model qualification prioritizes correct tool selection,
valid arguments, structured output, instruction following, authority boundaries,
and recovery after a rejected call.

As a useful current planning envelope, OpenAI's
[gpt-oss-20b](https://developers.openai.com/api/docs/models/gpt-oss-20b) is a
21-billion-parameter, 3.6-billion-active-parameter open model with function
calling and structured outputs. The llama.cpp project's
[deployment measurements](https://github.com/ggml-org/llama.cpp/discussions/15396)
put it at approximately 14.9 GB for 8K context, 15.5 GB for 32K, and 17.9 GB for
131K. A 16 GB GPU can technically approach this class of model, but leaves too
little operating margin to be the standard customer recommendation.

DPF uses **32K as the practical buying baseline** and retrieval tools to bring
the relevant records into the prompt. Larger windows are useful for specific
workflows, but they increase memory use and latency and do not automatically
improve tool judgment.

For several simultaneous AI conversations, use an approved provider or a
throughput-oriented inference service. Docker recommends its llama.cpp engine
for memory-efficient local and single-user work, and vLLM on supported NVIDIA
hosts for higher throughput. See [Docker Model Runner inference
engines](https://docs.docker.com/ai/model-runner/inference-engines/).

## Shared-memory systems not yet in the standard profile

The market now includes additional 128 GB shared-memory machines:

- [Framework Desktop](https://frame.work/desktop?tab=machine-learning) combines
  Ryzen AI Max+ 395 with 128 GB shared memory and can allocate up to 96 GB to its
  Radeon GPU. Docker Model Runner's GPU-backed Windows path currently requires
  NVIDIA; AMD acceleration is available through Docker Engine on Linux, while
  DPF's native Linux install remains early access.
- [NVIDIA DGX Spark](https://marketplace.nvidia.com/en-us/enterprise/personal-ai-supercomputers/dgx-spark/)
  and OEM GB10 systems such as HP ZGX Nano and Lenovo ThinkStation PGX provide
  128 GB coherent unified memory in a compact Linux ARM system. DPF publishes
  multi-architecture images, but its standard local-inference path on this
  hardware has not yet been qualified.

These machines are strong evaluation candidates and may become excellent DPF
appliances. Do not buy one as the default production host until the exact DPF
installer, Docker Model Runner backend, model, tool-call parser, and recovery
path have passed the same functional checks as the generally available Windows
and Apple Silicon routes.

## Before ordering

- Prefer Windows 11 Pro or a currently supported macOS release.
- Buy at least 1 TB storage; choose 2 TB for local models and 4 TB for contributor
  work. Keep backups on separate storage.
- Include a UPS for a machine that hosts the organization's operational data.
- Check noise, thermals, electrical service, warranty, and replacement time.
- Treat GPU memory, system memory, model format, context length, and concurrent
  services as one capacity plan.
- Recheck this dated guide and the live manufacturer configuration before
  purchase.
