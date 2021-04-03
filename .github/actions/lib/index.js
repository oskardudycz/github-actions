const { cherryPickCommits } = require("./cherry-pick");

const CreationStatus = {
  CREATED: "CREATED",
  ALREADY_EXITS: "ALREADY_EXISTS",
};

async function getLastCommitInBranch(octokit, { repo, owner, branch }) {
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

async function createNewBranch(
  octokit,
  { repo, owner, newBranchName, targetSha }
) {
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

async function getCommitsInPullRequest(
  octokit,
  { repo, owner, pullRequestNumber }
) {
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

async function cherryPick(octokit, { repo, owner, commits, head }) {
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

async function getPullRequest(octokit, { repo, owner, head, base, state }) {
  console.log(`Checking if PR exists ${base}, on ${head} and`);
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: state || "open",
    head,
    base,
  });

  return data[0];
}

async function createPullRequest(
  octokit,
  { repo, owner, title, head, base, body, checkIfAlreadyExists }
) {
  console.log(`Opening a PR against ${base}, on ${head} and title '${title}'`);

  if (checkIfAlreadyExists === true || checkIfAlreadyExists === undefined) {
    const existingPullRequest = await getPullRequest(octokit, {
      repo,
      owner,
      head,
      base,
    });

    if (!!existingPullRequest) {
      console.log("Pull request is already opened");
      return {
        status: CreationStatus.ALREADY_EXITS,
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
    status: CreationStatus.CREATED,
    url: existingPullRequest.url,
  };
}

async function commentOnPR(octokit, { repo, owner, pullRequestNumber, body }) {
  console.log(`Commenting on PR #${pullRequestNumber}`);
  await octokit.pulls.createReview({
    owner,
    repo,
    event: "COMMENT",
    pull_number: pullRequestNumber,
    body,
  });
}

module.exports = {
  getLastCommitInBranch,
  createNewBranch,
  getCommitsInPullRequest,
  cherryPick,
  createPullRequest,
  commentOnPR,
  CreationStatus,
};
