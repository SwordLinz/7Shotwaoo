import type { VideoEditorProject, VideoClip, BgmClip } from '../types/editor.types'
import { computeClipPositions } from '../utils/time-utils'

/**
 * Export a VideoEditorProject to JianYing (剪映) / CapCut Desktop draft format.
 *
 * Output: a JSON string representing `draft_content.json`.
 * The user should place this file inside a JianYing project folder and open it
 * with JianYing Desktop (or CapCut Desktop).
 *
 * Usage instructions for the user:
 *  1. Download all videos to a local folder
 *  2. Save the exported JSON as `draft_content.json`
 *  3. Create a JianYing project folder with `draft_meta_info.json` + `draft_content.json`
 *  4. Open the project in JianYing Desktop
 *
 * Notes on the format:
 *  - Durations are in **microseconds** (1 frame @ 30fps = 33333μs)
 *  - Material paths should be local absolute paths; we use the COS URLs as placeholders
 *    so JianYing will prompt to relink
 *  - track.type "video" for the main video track
 */

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function framesToMicroseconds(frames: number, fps: number): number {
  return Math.round((frames / fps) * 1_000_000)
}

function buildVideoMaterial(clip: VideoClip, fps: number, width: number, height: number) {
  const durationUs = framesToMicroseconds(
    clip.trim ? clip.trim.to - clip.trim.from : clip.durationInFrames,
    fps,
  )
  const materialName = clip.metadata?.description || `clip_${clip.id}`

  return {
    id: `material-${clip.id}`,
    type: 'video',
    path: clip.src,
    category_id: '',
    category_name: 'local',
    check_flag: 1,
    crop: {
      lower_left_x: 0.0, lower_left_y: 1.0,
      lower_right_x: 1.0, lower_right_y: 1.0,
      upper_left_x: 0.0, upper_left_y: 0.0,
      upper_right_x: 1.0, upper_right_y: 0.0,
    },
    duration: durationUs,
    extra_type_option: 0,
    formula_id: '',
    freeze: null,
    gameplay: null,
    has_audio: false,
    height,
    width,
    intensifies_audio_path: '',
    intensifies_path: '',
    is_ai_generate_content: false,
    is_copyright: false,
    is_text_edit_overdub: false,
    is_unified_beauty_mode: false,
    local_id: '',
    local_material_id: '',
    material_id: '',
    material_name: materialName,
    material_url: '',
    multi_camera_info: null,
    plugin_id: '',
    reverse_intensifies_path: '',
    reverse_path: '',
    smart_motion: null,
    source_platform: 0,
    stable: null,
    team_id: '',
    video_algorithm: null,
  }
}

function buildAudioMaterial(clip: VideoClip, fps: number) {
  if (!clip.attachment?.audio?.src) return null
  const durationUs = framesToMicroseconds(clip.durationInFrames, fps)
  const name = clip.attachment.subtitle?.text || `voice_${clip.id}`

  return {
    id: `audio-material-${clip.id}`,
    type: 'audio',
    path: clip.attachment.audio.src,
    category_id: '',
    category_name: 'local',
    check_flag: 1,
    duration: durationUs,
    has_audio: true,
    height: 0,
    width: 0,
    material_name: name,
    material_url: '',
    source_platform: 0,
  }
}

function buildSpeedMaterial(clipId: string) {
  return {
    id: `speed-${clipId}`,
    curve_speed: null,
    mode: 0,
    speed: 1.0,
    type: 'speed',
  }
}

function buildVideoSegment(
  clip: VideoClip,
  startUs: number,
  fps: number,
  speedId: string,
) {
  const durationUs = framesToMicroseconds(clip.durationInFrames, fps)
  const sourceStartUs = clip.trim ? framesToMicroseconds(clip.trim.from, fps) : 0
  const sourceDurationUs = clip.trim
    ? framesToMicroseconds(clip.trim.to - clip.trim.from, fps)
    : durationUs

  return {
    cartoon: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    common_keyframes: [],
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    extra_material_refs: [speedId],
    group_id: '',
    hdr_settings: null,
    id: `segment-${clip.id}`,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_db_value: -51.0,
    material_id: `material-${clip.id}`,
    render_index: 0,
    responsive_layout: {
      enable: false,
      horizontal_pos_layout: 0,
      size_layout: 0,
      target_follow: '',
      vertical_pos_layout: 0,
    },
    reverse: false,
    source_timerange: { duration: sourceDurationUs, start: sourceStartUs },
    speed: 1.0,
    target_timerange: { duration: durationUs, start: startUs },
    template_id: '',
    template_scene: 'default',
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1.0 },
    visible: true,
    volume: 1.0,
  }
}

function buildAudioSegment(
  clip: VideoClip,
  startUs: number,
  fps: number,
  speedId: string,
) {
  if (!clip.attachment?.audio?.src) return null

  const durationUs = framesToMicroseconds(clip.durationInFrames, fps)
  const volume = clip.attachment.audio.volume ?? 1.0

  return {
    cartoon: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    common_keyframes: [],
    enable_adjust: false,
    enable_color_correct_adjust: false,
    enable_color_curves: false,
    enable_color_match_adjust: false,
    enable_color_wheels: false,
    enable_lut: false,
    enable_smart_color_adjust: false,
    extra_material_refs: [speedId],
    group_id: '',
    hdr_settings: null,
    id: `audio-segment-${clip.id}`,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_db_value: -51.0,
    material_id: `audio-material-${clip.id}`,
    render_index: 0,
    responsive_layout: {
      enable: false,
      horizontal_pos_layout: 0,
      size_layout: 0,
      target_follow: '',
      vertical_pos_layout: 0,
    },
    reverse: false,
    source_timerange: { duration: durationUs, start: 0 },
    speed: 1.0,
    target_timerange: { duration: durationUs, start: startUs },
    template_id: '',
    template_scene: 'default',
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1.0 },
    visible: true,
    volume,
  }
}

function buildBgmSegment(bgm: BgmClip, fps: number, speedId: string) {
  const startUs = framesToMicroseconds(bgm.startFrame, fps)
  const durationUs = framesToMicroseconds(bgm.durationInFrames, fps)

  return {
    cartoon: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    common_keyframes: [],
    enable_adjust: false,
    enable_color_correct_adjust: false,
    enable_color_curves: false,
    enable_color_match_adjust: false,
    enable_color_wheels: false,
    enable_lut: false,
    enable_smart_color_adjust: false,
    extra_material_refs: [speedId],
    group_id: '',
    hdr_settings: null,
    id: `bgm-segment-${bgm.id}`,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_db_value: -51.0,
    material_id: `bgm-material-${bgm.id}`,
    render_index: 0,
    responsive_layout: {
      enable: false,
      horizontal_pos_layout: 0,
      size_layout: 0,
      target_follow: '',
      vertical_pos_layout: 0,
    },
    reverse: false,
    source_timerange: { duration: durationUs, start: 0 },
    speed: 1.0,
    target_timerange: { duration: durationUs, start: startUs },
    template_id: '',
    template_scene: 'default',
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1.0 },
    visible: true,
    volume: bgm.volume,
  }
}

function buildTransitionMaterial(clip: VideoClip, fps: number) {
  if (!clip.transition || clip.transition.type === 'none') return null
  const durationUs = framesToMicroseconds(clip.transition.durationInFrames, fps)
  return {
    id: `transition-${clip.id}`,
    category_id: '',
    category_name: 'dissolve',
    duration: durationUs,
    effect_id: '',
    is_overlap: true,
    name: clip.transition.type === 'dissolve' ? '叠化'
      : clip.transition.type === 'fade' ? '闪白'
        : clip.transition.type === 'slide' ? '推动'
          : '叠化',
    path: '',
    platform: 'all',
    type: 'transition',
    value: 0,
  }
}

export function exportToJianyingDraft(project: VideoEditorProject): string {
  const { fps, width, height } = project.config
  const computed = computeClipPositions(project.timeline)
  const totalDurationUs = computed.length > 0
    ? framesToMicroseconds(computed[computed.length - 1].endFrame, fps)
    : 0

  const videoMaterials = computed.map(c => buildVideoMaterial(c, fps, width, height))
  const audioMaterials = computed
    .map(c => buildAudioMaterial(c, fps))
    .filter((m): m is NonNullable<typeof m> => m !== null)
  const speedMaterials = [
    ...computed.map(c => buildSpeedMaterial(c.id)),
    ...project.bgmTrack.map(b => buildSpeedMaterial(b.id)),
  ]
  const transitionMaterials = computed
    .map(c => buildTransitionMaterial(c, fps))
    .filter((t): t is NonNullable<typeof t> => t !== null)

  const bgmMaterials = project.bgmTrack.map(bgm => ({
    id: `bgm-material-${bgm.id}`,
    type: 'audio',
    path: bgm.src,
    category_id: '',
    category_name: 'local',
    check_flag: 1,
    duration: framesToMicroseconds(bgm.durationInFrames, fps),
    has_audio: true,
    height: 0,
    width: 0,
    material_name: `bgm_${bgm.id}`,
    material_url: '',
    source_platform: 0,
  }))

  const videoSegments = computed.map(c =>
    buildVideoSegment(c, framesToMicroseconds(c.startFrame, fps), fps, `speed-${c.id}`),
  )
  const audioSegments = computed
    .map(c => buildAudioSegment(c, framesToMicroseconds(c.startFrame, fps), fps, `speed-${c.id}`))
    .filter((s): s is NonNullable<typeof s> => s !== null)
  const bgmSegments = project.bgmTrack.map(b =>
    buildBgmSegment(b, fps, `speed-${b.id}`),
  )

  const tracks: Array<Record<string, unknown>> = [
    {
      attribute: 0,
      flag: 0,
      id: uuid(),
      is_default_name: true,
      name: '',
      segments: videoSegments,
      type: 'video',
    },
  ]

  if (audioSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uuid(),
      is_default_name: true,
      name: '',
      segments: audioSegments,
      type: 'audio',
    })
  }

  if (bgmSegments.length > 0) {
    tracks.push({
      attribute: 0,
      flag: 0,
      id: uuid(),
      is_default_name: true,
      name: '',
      segments: bgmSegments,
      type: 'audio',
    })
  }

  const draft = {
    canvas_config: { width, height, ratio: 'original' },
    color_space: 0,
    config: { adjust_max_index: 1, attachment_info: [] },
    cover: '',
    duration: totalDurationUs,
    extra_info: '',
    fps: fps * 1.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: uuid(),
    keyframe_graph_list: [],
    last_modified_platform: {
      os: 'windows',
      app_id: 1,
      device_id: '',
      hard_disk_id: '',
      app_source: '',
      app_version: '',
    },
    materials: {
      audios: [...audioMaterials, ...bgmMaterials],
      beats: [],
      canvases: [],
      chromas: [],
      color_curves: [],
      effects: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks: [],
      material_animations: [],
      material_colors: [],
      multi_language_refs: [],
      placeholders: [],
      plugin_effects: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: [],
      speeds: speedMaterials,
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: [],
      transitions: transitionMaterials,
      video_effects: [],
      video_trackings: [],
      videos: videoMaterials,
      vocals: [],
      voice_changers: [],
    },
    mutable_config: null,
    name: '',
    new_version: '73.0.0',
    platform: { os: 'windows', app_id: 1 },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    tracks,
    update_time: 0,
    version: 360000,
  }

  return JSON.stringify(draft, null, 2)
}

export function exportJianyingMeta(projectName?: string): string {
  const meta = {
    draft_cloud_last_action_download: false,
    draft_cloud_purchase: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: null,
    draft_cloud_videocut_purchase: '',
    draft_cover: '',
    draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '' },
    draft_fold_path: '',
    draft_id: '',
    draft_is_ai_shorts: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: '',
    draft_is_invisible: false,
    draft_materials_copied: false,
    draft_materials_video_batch_situation: [],
    draft_name: projectName || 'Wacoo Export',
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: null,
    draft_timeline_materials_size_: 0,
    draft_type: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_create: Math.floor(Date.now() / 1000),
    tm_draft_modified: Math.floor(Date.now() / 1000),
    tm_draft_removed: 0,
    tm_duration: 0,
  }
  return JSON.stringify(meta, null, 2)
}
