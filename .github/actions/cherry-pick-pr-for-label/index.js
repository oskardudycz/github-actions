const core = require("@actions/core");
const github = require("@actions/github");

const {
  getLastCommitInBranch,
  createNewBranch,
  getCommitsInPullRequest,
  cherryPick,
  createPullRequest,
  commentOnPR,
  CreationStatus,
} = require("../lib");

const CHERRY_PICK_LABEL = "cherry-pick";

function getTargetBranchesFromLabels(pullRequest) {
  return pullRequest.labels
    .filter((label) => label.name.startsWith(CHERRY_PICK_LABEL))
    .map((label) => label.name.split(":")[1])
    .filter((label) => !!label);
}

async function createPullRequestWithCherryPick(
  octokit,
  { repo, owner, targetBranch, pullRequest, actor, actionRunId }
) {
  try {
    const targetSha = await getLastCommitInBranch(octokit, {
      repo,
      owner,
      branch: targetBranch,
    });

    const newBranchName = `cherry-pick/${pullRequest.number}/${pullRequest.head.ref}-${targetBranch}`;

    const {
      status: newBranchStatus,
      branchRef: newBranch,
    } = await createNewBranch(octokit, {
      repo,
      owner,
      newBranchName,
      targetSha,
    });

    if (newBranchStatus === CreationStatus.ALREADY_EXITS) {
      console.log(`Branch ${newBranchName} already exists`);
    } else {
      const commits = await getCommitsInPullRequest(octokit, {
        repo,
        owner,
        pullRequestNumber: pullRequest.number,
      });

      await cherryPick(octokit, {
        repo,
        owner,
        commits,
        head: newBranch,
      });
    }

    const newTitle = `[${targetBranch}] ${pullRequest.title}`;
    const body = `Cherry picked from https://${owner}/${repo}/pull/${pullRequest.number}`;

    const { url: newPullRequestUrl } = await createPullRequest(octokit, {
      repo,
      owner,
      title: newTitle,
      head: newBranch,
      base: targetBranch,
      body,
    });

    await commentOnPR(octokit, {
      repo,
      owner,
      pullRequestNumber: pullRequest.number,
      body: `@${actor} 👉 Created pull request targeting ${targetBranch}: ${newPullRequestUrl}`,
    });

    return true;
  } catch (ex) {
    const errorMessage = `Failed to create cherry Pick PR due to error '${ex}'`;
    console.error(errorMessage);

    await commentOnPR(octokit, {
      repo,
      owner,
      pullRequestNumber: pullRequest.number,
      body: `🚨 @${actor} ${errorMessage}. Check https://github.com/oskardudycz/EventStore/actions/runs/${actionRunId}`,
    });
    return false;
  }
}

async function run() {
  try {
    const octokit = github.getOctokit(core.getInput("GITHUB_TOKEN"));

    const {
      actor,
      runId: actionRunId,
      payload: { pull_request: pullRequest },
    } = github.context;

    const {
      base: {
        repo: {
          name: repo,
          owner: { login: owner },
        },
      },
    } = pullRequest;

    const targetBranches = getTargetBranchesFromLabels(pullRequest);

    let anyCherryPickFailed = false;

    for (const targetBranch of targetBranches) {
      const isCreated = await createPullRequestWithCherryPick(octokit, {
        repo,
        owner,
        targetBranch,
        pullRequest,
        actor,
        actionRunId,
      });

      if (!isCreated) {
        anyCherryPickFailed = true;
      }
    }
    if (anyCherryPickFailed) {
      core.setFailed(
        "Failed to create one of the cherry Pick PRs. Check the details above."
      );
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
