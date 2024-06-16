import fs from 'fs';

import * as core from '@actions/core';
import {exec} from '@actions/exec';
import * as github from '@actions/github';
import {graphql} from '@octokit/graphql';

async function run(): Promise<void> {
  try {
    const {owner, repo} = github.context.repo;
    const token = core.getInput('github-token');
    const message = core.getInput('message') || 'Default commit message';
    const branchName = process.env.GITHUB_HEAD_REF || 'master';

    if (!token) {
      core.setFailed('GitHub token not found');
      return;
    }

    const octokit = github.getOctokit(token); // might fail with an auth error?

    // Find updated file contents using the `git` cli.
    // ===============================================

    let gitOutput = '';
    let gitError = '';

    await exec('git', ['ls-files', '-om', '--exclude-standard'], {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          gitOutput += data.toString();
        },
        stderr: (data: Buffer) => {
          gitError += data.toString();
        },
      },
    });

    let expectedHeadOid = '';
    await exec('git', ['rev-parse', 'HEAD~'], {
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          expectedHeadOid += data.toString();
        },
        stderr: (data: Buffer) => {
          gitError += data.toString();
        },
      },
    });

    core.debug('🐭🐭🐭🐭🐭 gitOutput vvv');
    core.debug(gitOutput);
    core.debug('🐱🐱🐱🐱🐱 ^^^ gitOutput');

    if (!gitOutput && !expectedHeadOid) {
      return; // This action is a no-op if there are no changes.
    }
    if (gitError) {
      core.setFailed(`git stderr: ${gitError}`);
      return;
    }

    const files = gitOutput.split('\n');

    const additions = [];
    const deletions = [];

    for (const path of files) {
      if (!path.trim()) {
        continue;
      }
      if (fs.existsSync(path)) {
        additions.push({
          path,
          contents: fs.readFileSync(path, {encoding: 'base64'}),
        });
      } else {
        core.debug(`File removed: ${path}`);
        deletions.push({
          path,
        });
      }
    }

    const result = await graphql(
      `
        mutation createCommitOnBranch() {
          clientMutationId: 'id',
          branch: {
			      repositoryNameWithOwner: ${owner + '/' + repo},
			      branchName: ${branchName},
		      },
          message: ${message},
          fileChanges: {
            additions: ${additions},
            deletions: ${deletions},
          },
          expectedHeadOid: ${expectedHeadOid},
        }
      `,
      {
        headers: {
          authorization: `token ${token}`,
        },
      }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.error(error.stack || '');
      core.setFailed(error.message);
    } else {
      console.log(error);
      core.setFailed('catastrophe');
    }
  }
}

run();
