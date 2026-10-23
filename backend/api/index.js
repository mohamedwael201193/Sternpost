import { handler } from "../dist/serverless.js";
export const config = { maxDuration: 30 };
export default { fetch: handler };
