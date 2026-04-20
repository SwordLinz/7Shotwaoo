---
name: wacoo_seedance_2_volcengine
description: >-
  Explains Volcengine Ark Doubao Seedance 2.0 / 2.0 Fast (image-to-video) as wired in Wacoo:
  HTTP task API, Wacoo novel-promotion pipeline, niuniu vs ark provider keys, async externalId
  format, and polling. Use when integrating Seedance 2.0, debugging ARK:VIDEO tasks, 404 status
  polls, AccessDenied on ep, or mapping modelId to endpoint IDs.
---

# Wacoo × Volcengine Seedance 2.0 调用流程

## 适用场景

- 在 **Wacoo** 小说推广分镜里用 **Seedance 2.0 / 2.0 Fast** 做图生视频。
- 对照官方 **火山方舟** HTTP：创建异步任务、轮询结果。
- 排查 **轮询 404**、**403 AccessDenied**、**API Key 与接入点不一致**等问题。

## 官方 HTTP（与 Wacoo 实现对齐）

- **Base**：`https://ark.cn-beijing.volces.com`
- **创建任务**：`POST /api/v3/contents/generations/tasks`
  - Header：`Authorization: Bearer <ARK_API_KEY>`（密钥需 trim，勿重复 `Bearer` 前缀）
  - Body：`model`（控制台「推理接入点」ID，形如 `ep-…`）、`content` 多模态数组（图生视频：`text` + `image_url`；首尾帧再追加尾帧 `image_url` + `role`）
- **查询任务**：`GET /api/v3/contents/generations/tasks/{task_id}`
  - 响应 `status`：`succeeded` / `failed` / 其它未结束；成功时从 `content.video_url` 取成片 URL。

## Wacoo 产品内链路（自上而下）

1. **HTTP 入口**：`POST /api/novel-promotion/{projectId}/generate-video`  
   Body 含 `storyboardId`、`panelIndex`、`videoModel`（模型键）、可选 `generationOptions`、`firstLastFrame` 等；鉴权通过后 **`submitTask`** 投递 **`VIDEO_PANEL`** 任务。

2. **Worker**：`video.worker` → `generateVideoForPanel` → `resolveVideoSourceFromGeneration`  
   - 将分镜图转为可生成用的数据 URL/base64，拼 **`prompt`、比例、分辨率、时长、首尾帧** 等。

3. **统一生成入口**：`generateVideo(userId, modelKey, imageUrl, options)`（`src/lib/generator-api.ts`）  
   - **`resolveModelSelection`** 解析 **`niuniu::doubao-seedance-2-0`** 这类键，得到 **`provider` + `modelId`**。

4. **工厂路由视频生成器**：`createVideoGenerator(provider)`（`src/lib/generators/factory.ts`）  
   - **`ark`** 与 **`niuniu`** 均走 **`ArkSeedanceVideoGenerator`**（同一实现，区别在 **用户库里配置的 API Key 归属的 provider**）。

5. **Seedance 实现**：`ArkVideoGenerator` / `ArkSeedanceVideoGenerator`（`src/lib/generators/ark.ts`）  
   - **`getProviderConfig(userId, providerId)`**，`providerId` 来自模型（如 **`niuniu`** 或 **`ark`**）。  
   - **2.0 / 2.0 Fast** 的 `model` 字段使用 **接入点 ID**（代码里由 **`ARK_SEEDANCE_ENDPOINT_BY_MODEL_ID`** 将稳定 `modelId` 映到 **`ep-…`**，可按环境调整）。  
   - 创建成功后返回异步结果：`externalId` 必须 **与轮询使用同一 Wacoo provider**：  
     - 仅 **`ark`**：`ARK:VIDEO:<cgt_task_id>`  
     - **非 ark（如 niuniu）**：`ARK:VIDEO:<providerId>:<cgt_task_id>`

6. **异步轮询**：`pollAsyncTask` → `pollArkTask`（`src/lib/async-poll.ts`）  
   - **`getProviderConfig(userId, arkProviderKey)`**，其中 **`arkProviderKey`** 由 **`externalId`** 解析（三段默认为 **`ark`**，四段起第二段为 **Wacoo provider id**）。  
   - 轮询实现：`querySeedanceVideoStatus` → 上文 **GET …/tasks/{id}`**（`src/lib/async-task-utils.ts`）。

## Seedance 2.0 系列约束（产品 / 校验侧摘要）

- **时长**：整数 **4–15**，或 **-1**（智能时长，若模型规格支持）。  
- **分辨率**：**2.0 / 2.0 Fast** 仅 **480p / 720p**（不设 1080p）。  
- **首尾帧**：2.0 支持首尾帧时走两帧 `image_url` + `role`；2.0 Fast 规格上不支持首尾帧（以 catalog / 规格表为准）。  
- **不要用错 provider 轮询**：创建任务用 **`niuniu`** 的 Key，轮询也必须用 **`niuniu`**；若 `externalId` 仍是无 provider 的三段形式却实际用的是 niuniu Key 创建，易出现 **任务查询 404**。

## 排错速查

| 现象 | 常见原因 |
|------|----------|
| 轮询 **404** | **查询用的 Key 与创建不一致**；或 task id 损坏。确认 **`ARK:VIDEO:…`** 是否带 **`niuniu`**（与创建侧一致）。 |
| **403 AccessDenied** | API Key 与 **接入点 `ep-…`** 不属于同一火山账号/权限。 |
| **401 / key format** | Key 含多余引号、重复 `Bearer `；应对密钥 **trim** 并只设 **`Bearer <token>`** 一次。 |

## 与本 Skill 相关的仓库路径（Wacoo）

- `src/lib/generators/ark.ts` — 请求体、规格、`externalId`  
- `src/lib/ark-api.ts` — 创建任务 HTTP  
- `src/lib/async-poll.ts` — **`externalId`** 解析与 **`pollArkTask`**  
- `src/lib/async-task-utils.ts` — **`querySeedanceVideoStatus`**  
- `src/lib/generators/factory.ts` — **`niuniu` → ArkSeedance**  
- `src/app/api/novel-promotion/[projectId]/generate-video/route.ts` — 入口路由  
- `src/lib/workers/video.worker.ts` — 面板视频任务
