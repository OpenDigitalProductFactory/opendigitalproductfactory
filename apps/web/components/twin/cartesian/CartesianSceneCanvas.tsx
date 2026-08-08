"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useNodesState,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  CartesianSceneLayout,
  SceneEntityRef,
} from "@dpf/storefront-templates";

import { Notice } from "@/components/ui/report-kit";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { useSaveState } from "@/lib/shared/use-save-state";
import {
  nudgeCartesianPlacement,
  sceneToCartesianNodeDescriptors,
  type CartesianSceneMode,
  type CartesianSceneNodeDescriptor,
  type CartesianScenePresentationMap,
} from "@/lib/twin/cartesian-scene";
import type { OperationalSceneLayoutSaveResult } from "@/lib/twin/operational-scene-layout-repository";

import {
  BaySceneNode,
  ChairSceneNode,
  GenericResourceSceneNode,
  RackSceneNode,
  SeatSceneNode,
  StationSceneNode,
  TableSceneNode,
} from "./CartesianResourceNode";
import { CartesianZoneNode } from "./CartesianZoneNode";

const CARTESIAN_NODE_TYPES = {
  zone: CartesianZoneNode,
  table: TableSceneNode,
  chair: ChairSceneNode,
  bay: BaySceneNode,
  rack: RackSceneNode,
  seat: SeatSceneNode,
  station: StationSceneNode,
  resource: GenericResourceSceneNode,
};

export interface CartesianSceneSaveInput {
  sceneId: string;
  expectedVersion: number;
  layout: CartesianSceneLayout;
}

export interface CartesianScenePersistence {
  sceneId: string;
  version: number;
  onSave(
    input: CartesianSceneSaveInput,
  ): Promise<OperationalSceneLayoutSaveResult>;
}

export interface CartesianSceneCanvasProps {
  scene: CartesianSceneLayout;
  mode: CartesianSceneMode;
  modeOptions?: readonly CartesianSceneMode[];
  onModeChange?: (mode: CartesianSceneMode) => void;
  ariaLabel: string;
  bindings?: CartesianScenePresentationMap;
  persistence?: CartesianScenePersistence;
  onActivate?: (placementId: string, entityRef: SceneEntityRef) => void;
  empty?: ReactNode;
  height?: number;
  className?: string;
  /** Hide mode and list chrome when a parent owns those controls. */
  chrome?: "full" | "embedded";
  /** Lock viewport gestures while preserving activation of resource nodes. */
  navigation?: "interactive" | "locked";
}

function toFlowNodes(
  descriptors: readonly CartesianSceneNodeDescriptor[],
  onActivate: CartesianSceneCanvasProps["onActivate"],
): Node[] {
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    type: descriptor.nodeType,
    position: descriptor.position,
    data:
      descriptor.kind === "placement"
        ? {
            ...descriptor.data,
            ...(descriptor.data.interactive && onActivate
              ? {
                  onActivate: () =>
                    onActivate(
                      descriptor.data.placementId,
                      descriptor.data.entityRef,
                    ),
                }
              : {}),
          }
        : descriptor.data,
    draggable: descriptor.draggable,
    selectable: descriptor.selectable,
    connectable: false,
    ...(descriptor.parentId ? { parentId: descriptor.parentId } : {}),
    zIndex: descriptor.zIndex,
    style: {
      width: descriptor.width,
      height: descriptor.height,
    },
  }));
}

function modeLabel(mode: CartesianSceneMode): string {
  if (mode === "configure") return "Adjust layout";
  if (mode === "operate") return "Live operation";
  return "Availability view";
}

function ScenePlacementList({
  ariaLabel,
  descriptors,
  className,
}: {
  ariaLabel: string;
  descriptors: readonly Extract<
    CartesianSceneNodeDescriptor,
    { kind: "placement" }
  >[];
  className: string;
}) {
  return (
    <ul aria-label={`${ariaLabel} details`} className={className}>
      {descriptors.map((descriptor) => (
        <li key={descriptor.id}>
          <span className="font-dpf-semibold">{descriptor.data.label}:</span>{" "}
          {descriptor.data.statusLabel}
          {descriptor.data.sublabel ? ` — ${descriptor.data.sublabel}` : ""}
          {descriptor.data.cogSuggested ? " — Recommended" : ""}
        </li>
      ))}
    </ul>
  );
}

export function CartesianSceneCanvas({
  scene,
  mode,
  modeOptions,
  onModeChange,
  ariaLabel,
  bindings,
  persistence,
  onActivate,
  empty,
  height = 520,
  className = "",
  chrome = "full",
  navigation = "interactive",
}: CartesianSceneCanvasProps) {
  const versionRef = useRef(persistence?.version ?? 1);
  useEffect(() => {
    versionRef.current = persistence?.version ?? 1;
  }, [persistence?.sceneId, persistence?.version]);

  const persist = useCallback(
    async (
      next: CartesianSceneLayout,
    ): Promise<OperationalSceneLayoutSaveResult> => {
      if (!persistence) {
        return {
          ok: false,
          code: "unavailable",
          error:
            "Editing is unavailable until this operational layout is configured.",
        };
      }
      const result = await persistence.onSave({
        sceneId: persistence.sceneId,
        expectedVersion: versionRef.current,
        layout: next,
      });
      if (result.ok) versionRef.current = result.version;
      return result;
    },
    [persistence],
  );

  const save = useSaveState<CartesianSceneLayout>({
    value: scene,
    onSave: persist,
    debounceMs: 1_500,
    resetKey: persistence?.sceneId,
    failureMessage: "The layout could not be saved. Try again.",
  });
  const effectiveMode =
    mode === "configure" && !persistence ? "read-only" : mode;
  const descriptors = useMemo(
    () =>
      sceneToCartesianNodeDescriptors(save.value, {
        mode: effectiveMode,
        ...(bindings ? { bindings } : {}),
      }),
    [bindings, effectiveMode, save.value],
  );
  const descriptorById = useMemo(
    () => new Map(descriptors.map((descriptor) => [descriptor.id, descriptor])),
    [descriptors],
  );
  const projectedNodes = useMemo(
    () => toFlowNodes(descriptors, onActivate),
    [descriptors, onActivate],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(projectedNodes);

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (effectiveMode !== "configure") return;
      const descriptor = descriptorById.get(node.id);
      if (!descriptor || descriptor.kind !== "placement") return;
      const parent = descriptor.parentId
        ? descriptorById.get(descriptor.parentId)
        : undefined;
      const absolutePosition =
        parent?.kind === "zone"
          ? {
              x: parent.absolutePosition.x + node.position.x,
              y: parent.absolutePosition.y + node.position.y,
            }
          : node.position;
      const next = nudgeCartesianPlacement(
        save.value,
        descriptor.data.placementId,
        absolutePosition,
      );
      if (next !== save.value) save.change(next);
    },
    [descriptorById, effectiveMode, save],
  );

  if (scene.placements.length === 0) {
    return (
      <section
        aria-label={ariaLabel}
        className={`rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-lg ${className}`.trim()}
      >
        {empty ?? (
          <p className="text-dpf-body text-dpf-muted">
            No resources are placed in this layout yet.
          </p>
        )}
      </section>
    );
  }

  const placementDescriptors = descriptors.filter(
    (descriptor) => descriptor.kind === "placement",
  );

  return (
    <section
      aria-label={ariaLabel}
      className={`flex flex-col gap-dpf-sm ${className}`.trim()}
    >
      {chrome === "full" ? (
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-dpf-sm">
        {onModeChange && modeOptions && modeOptions.length > 1 ? (
          <label className="flex items-center gap-dpf-xs text-dpf-body font-dpf-medium text-dpf-text">
            <span>View</span>
            <select
              aria-label="Layout mode"
              className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-surface-1 px-dpf-sm text-dpf-body text-dpf-text"
              value={mode}
              onChange={(event) =>
                onModeChange(event.target.value as CartesianSceneMode)
              }
            >
              {modeOptions.map((option) => (
                <option key={option} value={option}>
                  {modeLabel(option)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-dpf-body font-dpf-semibold text-dpf-text">
            {modeLabel(mode)}
          </span>
        )}
        {mode === "configure" ? (
          <SaveStateIndicator
            status={save.status}
            error={save.error}
            onRetry={save.retry}
            onRevert={save.revert}
            pendingLabel="Saving layout…"
            savedLabel="Layout saved"
            compact
          />
        ) : null}
      </div>
      ) : null}

      {mode === "configure" && !persistence ? (
        <Notice variant="warn" title="Layout editing unavailable">
          Finish setting up this location before moving resources.
        </Notice>
      ) : null}

      <div
        className="overflow-hidden rounded-dpf-lg border border-dpf-border bg-dpf-surface-2"
        style={{ height }}
      >
        <ReactFlow
          aria-label={`${ariaLabel} canvas`}
          nodes={nodes}
          edges={[]}
          nodeTypes={CARTESIAN_NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          defaultViewport={scene.viewport}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={effectiveMode === "configure"}
          nodesConnectable={false}
          elementsSelectable={effectiveMode !== "read-only"}
          snapToGrid={effectiveMode === "configure"}
          snapGrid={[8, 8]}
          panOnScroll={navigation === "interactive"}
          panOnDrag={navigation === "interactive"}
          zoomOnScroll={navigation === "interactive"}
          zoomOnPinch={navigation === "interactive"}
          zoomOnDoubleClick={navigation === "interactive"}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="var(--dpf-border)" />
          {navigation === "interactive" ? (
            <Controls showInteractive={false} />
          ) : null}
        </ReactFlow>
      </div>

      {chrome === "full" ? (
      <details className="rounded-dpf-md border border-dpf-border bg-dpf-surface-1">
        <summary className="dpf-tap-target cursor-pointer px-dpf-md py-dpf-xs text-dpf-body font-dpf-medium text-dpf-text">
          View layout as a list
        </summary>
        <ScenePlacementList
          ariaLabel={ariaLabel}
          descriptors={placementDescriptors}
          className="grid gap-dpf-xs border-t border-dpf-border p-dpf-md text-dpf-body text-dpf-text"
        />
      </details>
      ) : (
        <ScenePlacementList
          ariaLabel={ariaLabel}
          descriptors={placementDescriptors}
          className="sr-only"
        />
      )}
    </section>
  );
}
