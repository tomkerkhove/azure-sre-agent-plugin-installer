const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "assets", "app.js"),
  "utf8"
);

function createContext(overrides = {}) {
  const context = {
    URL,
    URLSearchParams,
    Response,
    document: {
      addEventListener() {},
    },
    window: {
      location: {
        href: "https://example.github.io/installer/?repo=owner/plugin",
      },
      SRE_AGENT_INSTALLER_CONFIG: {
        clientId: "11111111-1111-4111-8111-111111111111",
        tenantId: "organizations",
        dataPlaneScope: "https://azuresre.dev/.default",
      },
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(appSource, context);
  return context;
}

test("validates Azure SRE Agent data plane endpoints", () => {
  const context = createContext();

  assert.equal(
    vm.runInContext(
      "normalizeAgentEndpoint('https://agent.hash.eastus.azuresre.ai/')",
      context
    ),
    "https://agent.hash.eastus.azuresre.ai"
  );

  for (const endpoint of [
    "http://agent.hash.eastus.azuresre.ai/",
    "https://username@agent.hash.eastus.azuresre.ai/",
    "https://agent.hash.eastus.azuresre.ai:443/",
    "https://agent.hash.eastus.azuresre.ai/other",
    "https://agent.hash.eastus.azuresre.ai/?query=value",
    "https://agent.hash.eastus.azuresre.ai/#fragment",
    "https://agent.hash.eastus.azuresre.ai.attacker.example/",
    "https://agent.example.com/",
    "not-a-url",
  ]) {
    assert.equal(
      vm.runInContext(
        `normalizeAgentEndpoint(${JSON.stringify(endpoint)})`,
        context
      ),
      null,
      endpoint
    );
  }
});

test("builds an import command with safely quoted JSON", () => {
  const importPath = `plugins/team's "plugin"`;
  const context = createContext({
    importEndpoint: "https://demo.hash.eastus.azuresre.ai",
    importRepo: "owner/plugin",
    importPath,
  });

  const command = vm.runInContext(
    "buildImportCommand(importEndpoint, importRepo, importPath)",
    context
  );
  const requestBody = JSON.stringify({
    sourceUrl: "owner/plugin",
    pathInRepo: importPath,
  });
  const shellQuotedBody =
    "'" + requestBody.replace(/'/g, "'\"'\"'") + "'";

  assert.match(command, /^TOKEN=\$\(az account get-access-token \\\n/);
  assert.match(
    command,
    /--url 'https:\/\/demo\.hash\.eastus\.azuresre\.ai\/api\/v2\/plugins\/install-direct' \\\n/
  );
  assert.ok(command.endsWith(`--data ${shellQuotedBody}`));
});

test("configures MSAL with memory-only caching", async () => {
  let capturedConfig;
  class PublicClientApplication {
    constructor(config) {
      capturedConfig = config;
    }

    async initialize() {}
  }

  const context = createContext({
    msal: { PublicClientApplication },
  });

  await vm.runInContext("getAuthClient()", context);

  assert.equal(capturedConfig.cache.cacheLocation, "memoryStorage");
  assert.equal(capturedConfig.cache.temporaryCacheLocation, "memoryStorage");
  assert.equal(
    capturedConfig.auth.authority,
    "https://login.microsoftonline.com/organizations"
  );
  assert.equal(
    capturedConfig.auth.redirectUri,
    "https://example.github.io/installer/auth.html"
  );
});

test("queries and normalizes accessible agents", async () => {
  let request;
  const context = createContext({
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo",
              name: "demo",
              subscriptionId: "sub",
              resourceGroup: "rg",
              location: "eastus",
              agentEndpoint: "https://demo.hash.eastus.azuresre.ai",
              powerState: "Running",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    },
  });

  const agents = await vm.runInContext(
    "queryAccessibleAgents('access-token')",
    context
  );
  const normalizedAgents = JSON.parse(JSON.stringify(agents));

  assert.match(request.url, /Microsoft\.ResourceGraph\/resources/);
  assert.match(request.url, /api-version=2024-04-01/);
  assert.equal(request.options.method, "POST");
  assert.match(JSON.parse(request.options.body).query, /microsoft\.app\/agents/);
  assert.deepEqual(normalizedAgents, [
    {
      id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo",
      name: "demo",
      subscriptionId: "sub",
      resourceGroup: "rg",
      location: "eastus",
      endpoint: "https://demo.hash.eastus.azuresre.ai",
      powerState: "Running",
    },
  ]);
});

test("refreshes the selected agent from ARM", async () => {
  let request;
  const context = createContext({
    fetch: async (url, options) => {
      request = { url: url.toString(), options };
      return new Response(
        JSON.stringify({
          properties: {
            agentEndpoint: "https://demo.hash.eastus.azuresre.ai",
            powerState: "Running",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    },
  });

  const agent = await vm.runInContext(
    `getCurrentAgent(
      {
        id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo",
        name: "demo",
        powerState: "Unknown"
      },
      "access-token"
    )`,
    context
  );
  const normalizedAgent = JSON.parse(JSON.stringify(agent));

  assert.equal(
    request.url,
    "https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/agents/demo?api-version=2025-05-01-preview"
  );
  assert.equal(normalizedAgent.powerState, "Running");
  assert.equal(
    normalizedAgent.endpoint,
    "https://demo.hash.eastus.azuresre.ai"
  );
});

test("posts the selected plugin to the agent import endpoint", async () => {
  let request;
  const context = createContext({
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 204 });
    },
  });

  const message = await vm.runInContext(
    `importPlugin(
      { endpoint: "https://demo.hash.eastus.azuresre.ai" },
      "owner/plugin",
      "plugins/demo",
      "access-token"
    )`,
    context
  );

  assert.equal(message, "");
  assert.equal(
    request.url,
    "https://demo.hash.eastus.azuresre.ai/api/v2/plugins/install-direct"
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    sourceUrl: "owner/plugin",
    pathInRepo: "plugins/demo",
  });
});
