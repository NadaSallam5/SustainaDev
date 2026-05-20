# SustainaDev — AI-Powered Sustainable Software Analysis

**SustainaDev** is an AI-powered VS Code extension that helps developers write more sustainable, efficient, and optimized code. It automatically detects code smells, suggests refactoring strategies, and measures the energy and carbon impact of your code.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 Code Smell Detection | Automatically identifies nested loops, recursion, string concatenation in loops, and sorting inefficiencies |
| ⚡ AI-Powered Optimization | Suggests and applies refactoring strategies using Tree-sitter AST analysis |
| 📊 Complexity Reports | Compares time and space complexity before and after optimization |
| 🌱 Sustainability Metrics | Estimates energy consumption (kWh) and carbon footprint (gCO₂) of your code |
| 📈 Dashboard | Visual overview of all optimization history and sustainability gains |
| 🖥️ System Specs | View hardware specifications relevant to energy profiling |

---

## 🌐 Supported Languages

- ☕ Java
- 🐍 Python
- 🟨 JavaScript
- 🔷 TypeScript

---

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a supported source file (`.java`, `.py`, `.js`, `.ts`)
3. Press `Ctrl+Shift+P` and run **SustainaDev: Analyze & Suggest Refactor**
4. Review the diff and accept or reject the optimization
5. View complexity and sustainability reports in the Output panel

---

## 🛠️ Commands

| Command | Description |
|---|---|
| `SustainaDev: Analyze & Suggest Refactor` | Analyze the active file and suggest optimizations |
| `SustainaDev: Open Dashboard` | Open the sustainability dashboard |
| `SustainaDev: Get System Specs` | View system hardware information |

---

## 📋 Requirements

- VS Code `1.104.0` or higher
- Java Language Server (for Java file analysis)

---

## 🔗 Resources

- [GitHub Repository](https://github.com/NadaSallam5/SustainaDev)
- [Report an Issue](https://github.com/NadaSallam5/SustainaDev/issues)

---

## 📄 License

MIT License — see [LICENSE](LICENSE.txt) for details.