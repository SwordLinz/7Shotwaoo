'use client'

import { useCallback } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Connection,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslations } from 'next-intl'
import { GlassButton, GlassSurface } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'
import ComfyUINode from './nodes/ComfyUINode'
import ImagePreviewNode from './nodes/ImagePreviewNode'

interface StoryboardNodeCanvasProps {
  projectId: string
  episodeId: string
}

type CanvasNodeData = { projectId: string; episodeId: string }

const nodeTypes: NodeTypes = {
  comfyui: ComfyUINode,
  imagePreview: ImagePreviewNode,
}

let nodeIdCounter = 0
function getNextNodeId() {
  return `node_${Date.now()}_${++nodeIdCounter}`
}

export default function StoryboardNodeCanvas({ projectId, episodeId }: StoryboardNodeCanvasProps) {
  const t = useTranslations('storyboard.nodeCanvas')
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])


  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  )

  const addNode = useCallback(
    (type: string) => {
      const id = getNextNodeId()
      const offsetX = 100 + (nodes.length % 5) * 50
      const offsetY = 100 + (nodes.length % 5) * 50
      const newNode: Node<CanvasNodeData> = {
        id,
        type,
        position: { x: offsetX, y: offsetY },
        data: { projectId, episodeId },
      }
      setNodes((nds) => [...nds, newNode])
    },
    [nodes.length, projectId, episodeId, setNodes],
  )

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 260px)' }}>
      <GlassSurface variant="elevated" className="absolute top-3 left-3 z-10 flex items-center gap-2 !p-2 !rounded-xl">
        <GlassButton variant="secondary" size="sm" onClick={() => addNode('comfyui')}>
          <AppIcon name="bolt" className="w-4 h-4" />
          <span>{t('addComfyNode')}</span>
        </GlassButton>
        <GlassButton variant="secondary" size="sm" onClick={() => addNode('imagePreview')}>
          <AppIcon name="image" className="w-4 h-4" />
          <span>{t('addImageNode')}</span>
        </GlassButton>
      </GlassSurface>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        className="glass-surface !rounded-xl"
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center space-y-1">
            <p className="text-base font-semibold text-[var(--glass-text-secondary)]">{t('emptyTitle')}</p>
            <p className="text-sm text-[var(--glass-text-tertiary)]">{t('emptyDescription')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
