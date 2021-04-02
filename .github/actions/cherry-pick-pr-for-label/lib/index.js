const { cherryPickCommits } = require("./cherry-pick");

exports.getLastCommit = async function (octokit, { repo, owner, branch }) {
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
};

exports.createNewBranch = async function (
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
};

exports.getCommitShasInPr = async function (
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
};

exports.cherryPick = async function (octokit, { repo, owner, commits, head }) {
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
};

exports.getPullRequest = async function (
  octokit,
  { repo, owner, head, base, state }
) {
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: state || "open",
    head,
    base,
  });

  return data[0];
};

exports.createPullRequest = async function ({
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
};

exports.commentOnPR = async function ({
  repo,
  owner,
  pullRequestNumber,
  body,
}) {
  await octokit.pulls.createReview({
    owner,
    repo,
    event: "COMMENT",
    pull_number: pullRequestNumber,
    body,
  });
};
