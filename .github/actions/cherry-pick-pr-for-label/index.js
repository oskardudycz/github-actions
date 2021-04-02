const core = require("@actions/core");
const github = require("@actions/github");
const { cherryPickCommits } = require("github-cherry-pick");

const {
  getLastCommit,
  createNewBranch,
  getCommitShasInPr,
  cherryPick,
  createPullRequest,
  commentOnPR,
} = require("utils");

const CHERRY_PICK_LABEL = "cherry-pick";

const CreationStatus = {
  CREATED: "CREATED",
  ALREADY_EXITS: "ALREADY_EXISTS",
};

function getTargetBranchesFromLabels(pullRequest) {
  return pullRequest.labels
    .filter((label) => label.name.startsWith(CHERRY_PICK_LABEL))
    .map((label) => label.name.split(":")[1])
    .filter((label) => !!label);
}

async function run() {
  try {
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

    const {
      actor,
      run_id: actionRunId,
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
      try {
        const targetSha = await getLastCommit(octokit, {
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
          const commits = await getCommitShasInPr(octokit, {
            repo,
            owner,
            pullRequestNumber: pullRequest.number,
          });

          await cherryPick(octokit, cherryPickCommits, {
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

        console.log("Commenting on PR with success");
        await commentOnPR(octokit, {
          repo,
          owner,
          pullRequestNumber: pullRequest.number,
          body: `@${actor} 👉 Created pull request targeting ${targetBranch}: ${newPullRequestUrl}`,
        });
        throw "test error";
      } catch (ex) {
        const errorMessage = `Failed to create cherry Pick PR due to error '${ex}'`;
        console.error(errorMessage);
        console.error("Commenting on PR with cherry-pick error");

        commentOnPR(octokit, {
          repo,
          owner,
          pullRequestNumber: pullRequest.number,
          body: `🚨 @${actor} ${errorMessage}. Check https://github.com/oskardudycz/EventStore/actions/runs/${actionRunId}`,
        });
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
