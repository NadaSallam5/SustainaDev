import * as cp from 'child_process';
export type Energy = { emissions_kg:number; estimated_kwh_saved:number; estimated_cost_saved_usd:number };
export async function estimateEnergy(deltaComplexity: number): Promise<Energy> {
  return new Promise((res, rej) => {
    cp.exec(`python metrics/estimate.py ${deltaComplexity}`, (e, stdout) => {
      if (e) return rej(e);
      try { res(JSON.parse(stdout)); } catch (err) { rej(err); }
    });
  });
}
