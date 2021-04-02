const core = require("@actions/core");
const github = require("@actions/github");

const { cherryPickCommits } = require("github-cherry-pick");
const { createActionAuth } = require("@octokit/auth");

const { Octokit } = require("@octokit/rest");
const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
//  new Octokit({
//   authStrategy: createActionAuth,
// });

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

async function getLastCommit({ repo, owner, branch }) {
  console.log(`Getting latest commit for branch ${branch}`);
  // Workaround for https://github.com/octokit/rest.js/issues/1506
  const urlToGet = `GET /repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const {
    status,
    data: {
      object: { sha },
    },
  } = await octokit.request(urlToGet, {
    repo,
    owner,
    branch,
  });

  if (status != 200) {
    throw `Failed to get branch branch details for '${branch}' : ${JSON.stringify(
      branchInfo
    )}`;
  }

  return sha;
}

async function createNewBranch({ repo, owner, newBranchName, targetSha }) {
  console.log(`Creating a branch ${newBranchName} with sha ${targetSha}`);

  const branchRef = `refs/heads/${newBranchName}`;

  try {
    const response = await octokit.git.createRef({
      owner,
      repo,
      ref: branchRef,
      sha: targetSha,
    });

    if (response.status != 201) {
      console.log("Error Response status" + response.status);
    }

    return { status: CreationStatus.CREATED, branchRef };
  } catch (err) {
    if (err.toString() === "HttpError: Reference already exists") {
      return { status: CreationStatus.ALREADY_EXITS, branchRef };
    }
    throw err;
  }
}

async function getCommitShasInPr({ repo, owner, pullRequestNumber }) {
  const pullRequestCommits = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: pullRequestNumber,
  });
  if (pullRequestCommits.status != 200) {
    throw `Failed to get commits on PR ${pullRequestNumber}: ${JSON.stringify(
      response
    )}`;
  }

  return pullRequestCommits.data.map((c) => c.sha);
}

async function cherryPick({ repo, owner, commits, head }) {
  console.log(`Cherry picking commits '${commits}' on '${head}'`);

  const newHeadSha = await cherryPickCommits({
    commits,
    head,
    octokit,
    owner,
    repo,
  });

  console.log(`New head after cherry pick: ${newHeadSha}`);
  return newHeadSha;
}

async function getPullRequest({ repo, owner, head, base, state }) {
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: state || "open",
    head,
    base,
  });

  return data[0];
}

async function createPullRequest({
  repo,
  owner,
  title,
  head,
  base,
  body,
  checkIfAlreadyExists,
}) {
  console.log(`Opening a PR against ${base}, on ${head} and title '${title}'`);

  if (checkIfAlreadyExists === true || checkIfAlreadyExists === undefined) {
    const existingPullRequest = await getPullRequest({
      repo,
      owner,
      head,
      base,
    });

    if (!!existingPullRequest) {
      console.log("Pull request is already opened");
      return {
        satus: CreationStatus.ALREADY_EXITS,
        url: existingPullRequest.url,
      };
    }
  }

  const {
    data: { url },
  } = await octokit.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });

  console.log(`Pull request ${url} has been opened`);

  return {
    satus: CreationStatus.CREATED,
    url: existingPullRequest.url,
  };
}

async function commentOnPR({ repo, owner, pullRequestNumber, body }) {
  await octokit.pulls.createReview({
    owner,
    repo,
    event: "COMMENT",
    pull_number: pullRequestNumber,
    body,
  });
}

async function run() {
  try {
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
        const targetSha = await getLastCommit({
          repo,
          owner,
          branch: targetBranch,
        });

        const newBranchName = `cherry-pick/${pullRequest.number}/${pullRequest.head.ref}-${targetBranch}`;

        const {
          status: newBranchStatus,
          branchRef: newBranch,
        } = await createNewBranch({
          repo,
          owner,
          newBranchName,
          targetSha,
        });

        if (newBranchStatus === CreationStatus.ALREADY_EXITS) {
          console.log(`Branch ${newBranchName} already exists`);
        } else {
          const commits = await getCommitShasInPr({
            repo,
            owner,
            pullRequestNumber: pullRequest.number,
          });

          await cherryPick({
            repo,
            owner,
            commits,
            head: newBranch,
          });
        }

        const newTitle = `[${targetBranch}] ${pullRequest.title}`;
        const body = `Cherry picked from https://${owner}/${repo}/pull/${pullRequest.number}`;

        const { url: newPullRequestUrl } = await createPullRequest({
          repo,
          owner,
          title: newTitle,
          head: newBranch,
          base: targetBranch,
          body,
        });

        console.log("Commenting on PR with success");
        await commentOnPR({
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

        commentOnPR({
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
