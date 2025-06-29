<h1 align="center">SynegoBase</h1>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue.svg?cacheSeconds=2592000" />
  <a href="./LICENSE" target="_blank">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </a>
</p>

> 一个高性能、可扩展的、基于 Nginx 和 Node.js/Go/Rust 的分布式服务器框架。

SynegoBase 旨在提供一个功能强大且灵活的后端解决方案，通过解耦的节点架构和丰富的功能集，帮助开发者快速构建稳定、高效的现代网络服务。

> **作者**: LostAbaddon
> **组织**: 此在（Dasein）
> **版本**: 0.1.0
> **状态**: 开发中

## 核心特性

- **🚀 混合式节点架构:** 清晰地分离负载均衡、任务派发和服务执行，易于扩展和维护。
- **🛡️ Nginx 深度集成:** 高效处理静态资源、文件上传，并为 SPA 提供内置支持。
- **🔗 多协议支持:** 原生支持 HTTP, HTTPS, WebSocket, RPC, gRPC 等多种通信协议。
- **⚖️ 智能负载均衡:** 基于节点健康度和负载动态分配请求，最大化资源利用率。
- **💻 灵活的服务实现:** 支���使用 Node.js, Go, 或 Rust 编写业务逻辑。
- **�� 多种并发模型:** 提供非线程、一次性线程和常驻线程池模式，应对不同业务场景。
- **❤️ 高可用性:** 内置服务自动注册、心跳检测和 PM2 进程守护，确保服务稳定。
- **✍️ 统一的日志系统:** 提供分级、按天归档的结构化日志，便于问题追踪。
- **👀 命令行监控:** 通过 CLI 工具实时洞察集群状态、服务负载和性能指标。
- **📦 开箱即用的数据库支持:** 可选配 Redis 和 MySQL 连接。

## 项目架构

SynegoBase 采用三层分布式架构，确保了职责的清晰分离和系统的高可扩展性。

```
+----------------------+      +----------------------+      +------------------------+
|                      |      |                      |      |                        |
|   Load Balancing     |----->|    Master Node(s)    |----->|    Service Node(s)     |
|       (Nginx)        |      |   (Task Dispatch)    |      |   (Business Logic)     |
|                      |<-----|                      |<-----|                        |
+----------------------+      +----------------------+      +------------------------+
```

1.  **负载均衡节点 (Load Balancing Node):** 作为流量入口，使用 Nginx 处理静态请求和反向��理动态请求。
2.  **主响应节点 (Master Node):** 负责接收动态请求，根据智能负载均衡算法将其分发给最合适的服务节点。
3.  **服务响应节点 (Service Node):** 执行具体的业务逻辑，并将结果返回给主节点。

## 快速开始

> **注意:** 项目正在积极开发中，以下为预期的使用方式。

### 先决条件

- [Nginx](https://nginx.org/en/download.html)
- [Node.js](https://nodejs.org/) (>= 18.0.0)
- [PM2](https://pm2.keymetrics.io/)

### 安装

```bash
npm install synegobase
```

### 配置

在您的项目根目录创建一个 `synego.config.json` 文件：

```json
{
  "nodes": [
    {
      "type": "master",
      "host": "localhost",
      "port": 3000
    }
  ]
}
```

### 运行

```bash
npx synego start
```

## 开发路线图

我们计划分阶段交付 SynegoBase 的全部功能。

- **[第一阶段]**
  - [x] 实现基本的 Nginx + Node.js 结构
  - [ ] 实现单进程内的主/服务节点通信
  - [ ] 完成基本的请求转发

- **[第二阶段]**
  - [ ] 实现跨进程的节点通信
  - [ ] 实现服务节点自动注册与心跳检测

- **[第三阶段]**
  - [ ] 支持多节点集群
  - [ ] 实现智能负载均衡算法
  - [ ] 构建统一日志服务

- **[第四阶段]**
  - [ ] 实现多种线程模型
  - [ ] 实现服务热重载
  - [ ] 集成 PM2 实现进程守护

- **[第五阶段]**
  - [ ] 集成 Redis 和 MySQL 支持
  - [ ] 开发命令行监控工具
  - [ ] 完善错误处理和文档

### 未来展望

- **Paxos/Raft 集成:** 消除主节点的单点故障风险。
- **背压机制:** 在高负载下优雅地处理服务降级。

## 如何贡献

我们欢迎所有形式的贡献！请阅读我们的 [CONTRIBUTING.md](CONTRIBUTING.md) 文件来了解如何帮助我们。

## 许可证

本项目采用 [MIT](./LICENSE) 许可证。
