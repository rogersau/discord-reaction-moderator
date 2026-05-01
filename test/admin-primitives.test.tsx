/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import { Alert, AlertDescription } from "../src/admin/components/ui/alert";
import { Button } from "../src/admin/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../src/admin/components/ui/card";
import { Input } from "../src/admin/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/admin/components/ui/table";

test("admin button uses standard shadcn button classes", () => {
  const html = renderToString(<Button>Save</Button>);

  assert.match(html, /rounded-md/);
  assert.match(html, /bg-primary/);
  assert.match(html, /text-primary-foreground/);
  assert.doesNotMatch(html, /shadow-\[/);
  assert.doesNotMatch(html, /rounded-xl/);
});

test("admin card and input use standard shadcn surface classes", () => {
  const html = renderToString(
    <>
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>
      <Input value="" onChange={() => undefined} />
    </>,
  );

  assert.match(html, /rounded-lg border bg-card text-card-foreground shadow-sm/);
  assert.match(html, /rounded-md border border-input bg-background/);
  assert.doesNotMatch(html, /rounded-\[1\.5rem\]/);
  assert.doesNotMatch(html, /shadow-inner/);
});

test("admin table and alert drop the custom accent-heavy chrome", () => {
  const html = renderToString(
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Value</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Alert>
        <AlertDescription>Saved.</AlertDescription>
      </Alert>
    </>,
  );

  assert.match(html, /w-full caption-bottom text-sm/);
  assert.match(html, /rounded-lg border p-4/);
  assert.doesNotMatch(html, /tracking-\[0\.2em\]/);
  assert.doesNotMatch(html, /rounded-2xl/);
});
