export { compileDist, type Sampler } from "./core/distributions";
export { Histogram } from "./core/histogram";
export { createStream, Rng } from "./core/rng";
export {
  compareResults,
  type MetricDelta,
  type MetricUnit,
  type ResultComparison,
} from "./metrics/comparison";
export * from "./model/types";
export {
  createSimulation,
  DEFAULT_BUCKET_MS,
  DEFAULT_DRAIN_MS,
  DEFAULT_MAX_TRACES,
  simulate,
} from "./runtime/simulation";
