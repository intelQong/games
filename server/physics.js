// Re-export the shared physics builders so server/test imports keep working
// after createWorld/createPlayerBody moved to shared/ for client-side prediction.
export { createWorld, createPlayerBody, Matter, Body, Composite, Query, Engine } from '../shared/physics.js';
