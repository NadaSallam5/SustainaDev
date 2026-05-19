import si from "systeminformation";
import { HardwareSpecs } from "./types";

export interface HardwareRecommendation {
    component: string;
    issue: string;
    recommendation: string;
    estimatedSavingWatts: number;
    priority: "high" | "medium" | "low";
}

export async function generateHardwareRecommendations(
    specs: HardwareSpecs
): Promise<HardwareRecommendation[]> {
    const recommendations: HardwareRecommendation[] = [];
    const disks = await si.diskLayout();
    const battery = await si.battery();
    const mem = await si.mem();

    // ── Disk ──
    const hasHdd = disks.some(d =>
        d.type?.toLowerCase().includes("hdd") ||
        d.type?.toLowerCase().includes("hd") ||
        (d as any).rotationSpeed > 0
    );
    const hasNvme = disks.some(d =>
        d.type?.toLowerCase().includes("nvme") ||
        d.name?.toLowerCase().includes("nvme")
    );
    const hasSata = disks.some(d =>
        d.type?.toLowerCase().includes("ssd") &&
        !d.name?.toLowerCase().includes("nvme")
    );

    if (hasHdd) {
        recommendations.push({
            component: "Storage",
            issue: "HDD detected — spinning disk uses 6–10W actively vs 0.5–2W for SSD",
            recommendation: "Replace HDD with SSD or NVMe — largest single hardware energy saving available",
            estimatedSavingWatts: 6,
            priority: "high",
        });
    } else if (hasSata && !hasNvme) {
        recommendations.push({
            component: "Storage",
            issue: "SATA SSD detected — uses 1.5–3W vs 0.05–0.1W idle for NVMe",
            recommendation: "Consider upgrading to NVMe SSD for lower idle power and faster I/O",
            estimatedSavingWatts: 1.5,
            priority: "low",
        });
    }

    // ── Battery ──
    if (battery.hasBattery && battery.designedCapacity && battery.maxCapacity) {
        const healthPct = (battery.maxCapacity / battery.designedCapacity) * 100;
        if (healthPct < 70) {
            recommendations.push({
                component: "Battery",
                issue: `Battery health is ${healthPct.toFixed(0)}% — degraded battery increases charge cycles and PSU load`,
                recommendation: "Replace battery to restore PSU efficiency and reduce energy waste during charging",
                estimatedSavingWatts: 2,
                priority: "high",
            });
        } else if (healthPct < 85) {
            recommendations.push({
                component: "Battery",
                issue: `Battery health is ${healthPct.toFixed(0)}% — starting to degrade`,
                recommendation: "Monitor battery health — consider replacement before it drops below 70%",
                estimatedSavingWatts: 1,
                priority: "medium",
            });
        }
    }

    // ── RAM ──
    const ramGb = mem.total / 1_073_741_824;
    if (ramGb < 8) {
        recommendations.push({
            component: "RAM",
            issue: `Only ${ramGb.toFixed(0)}GB RAM detected — low RAM causes excessive disk swapping`,
            recommendation: "Upgrade to at least 16GB RAM to eliminate swap-induced disk energy overhead",
            estimatedSavingWatts: 3,
            priority: "high",
        });
    } else if (ramGb < 16) {
        recommendations.push({
            component: "RAM",
            issue: `${ramGb.toFixed(0)}GB RAM — may cause swapping under heavy development workloads`,
            recommendation: "Consider upgrading to 16GB or 32GB for reduced disk I/O and better energy efficiency",
            estimatedSavingWatts: 1.5,
            priority: "medium",
        });
    }


    // Sort by priority then by saving
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        b.estimatedSavingWatts - a.estimatedSavingWatts
    );

    return recommendations;
}