import { createHash } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { MCPServer } from '@mastra/mcp';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { z } from 'zod';
import {
  serveSkills,
  skillInstructions,
  skillMarkdown,
  skillResources,
} from '@gitroom/nestjs-libraries/chat/skills/mcp.skill';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';

// An MCP server configured the way start.mcp.ts configures them (a ui://
// widget next to the skill), served over HTTP and reached with a real MCP
// client in each protocol era it answers
const mcpServer = serveSkills(
  new MCPServer({
    name: 'Omninoise MCP',
    version: '1.0.0',
    protocolVersion: '2026-07-28',
    tools: {},
    appResources: {
      'ui://spec/widget': { name: 'Widget', html: '<p>widget</p>' },
    },
    instructions: skillInstructions,
    resources: skillResources,
  })
);

let http: Server;
let url: URL;

beforeAll(async () => {
  http = createServer((req, res) => {
    mcpServer.startHTTP({
      url: new URL(req.url!, 'http://localhost'),
      httpPath: '/mcp',
      options: { serverless: true },
      req,
      res,
    });
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = new URL(`http://localhost:${(http.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  await new Promise((resolve) => http?.close(resolve));
});

const withClient = async (
  era: 'legacy' | 'modern',
  run: (client: Client) => Promise<void>
) => {
  const client = new Client(
    { name: 'skill-spec', version: '1.0.0' },
    era === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : {}
  );
  await client.connect(new StreamableHTTPClientTransport(url));
  try {
    await run(client);
  } finally {
    await client.close();
  }
};

const skillsSchema = z.object({ skills: z.array(z.any()) }).passthrough();
const skillSchema = z.object({ skill: z.any() }).passthrough();
const listSkills = async (client: Client) =>
  (await client.request({ method: 'skills/list', params: {} }, skillsSchema))
    .skills;

describe.each(['legacy', 'modern'] as const)('MCP skills, %s era', (era) => {
  test('the server declares the skills extension and names the skill in its instructions', () =>
    withClient(era, async (client) => {
      expect(client.getServerCapabilities()).toMatchObject({
        resources: {},
        extensions: {
          'io.modelcontextprotocol/skills': {},
          'io.modelcontextprotocol/ui': {},
        },
      });
      expect(client.getInstructions()).toContain(
        'skill://omninoise-mcp/SKILL.md'
      );
    }));

  test('the SKILL.md a client reads matches the size and digest skills/list gives', () =>
    withClient(era, async (client) => {
      const [skill] = await listSkills(client);
      expect(skill.frontmatter.name).toBe('omninoise-mcp');

      const [content] = (await client.readResource({ uri: skill.uri }))
        .contents;
      const bytes = Buffer.from('text' in content ? content.text : '', 'utf8');
      expect(content.mimeType).toBe('text/markdown');
      expect(skill.resources).toEqual([
        {
          uri: skill.uri,
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          size: bytes.length,
        },
      ]);
    }));

  test('skills/get returns the skill skills/list gives', () =>
    withClient(era, async (client) => {
      const [listed] = await listSkills(client);
      const { skill } = await client.request(
        { method: 'skills/get', params: { uri: listed.uri } },
        skillSchema
      );
      expect(skill).toEqual(listed);
    }));

  test('skills/get answers an unknown skill with invalid params', () =>
    withClient(era, async (client) => {
      const error = await client
        .request(
          { method: 'skills/get', params: { uri: 'skill://unknown/SKILL.md' } },
          skillSchema
        )
        .catch((e) => e);
      expect(error.code).toBe(-32602);
    }));
});

// Architecture test: the skill must not point agents at a tool that was
// renamed or removed
test('every tool the skill names is an MCP tool', () => {
  const toolNames = new Set(toolList.map((Tool) => new Tool().name));
  const named = [...skillMarkdown.matchAll(/`([a-z]+[A-Z]\w*)`/g)]
    .map(([, name]) => name)
    .filter((name) => /(Tool|List|Schema)$/.test(name));
  expect(named.length).toBeGreaterThan(20);
  expect(named.filter((name) => !toolNames.has(name))).toEqual([]);
});
