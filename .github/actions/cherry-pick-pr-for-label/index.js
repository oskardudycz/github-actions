const core = require('@actions/core');
const github = require('@actions/github');

const fs = require('fs');
// See https://git-scm.com/docs/git-cherry-pick for more details.
const { cherryPickCommits } = require("github-cherry-pick");


const {
  createActionAuth,
} = require("@octokit/auth");
const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({});
const owner = 'oskardudycz';
const repo = 'EventStore';

const validLabels = ['beta', 'stable'];
const trackingLabel = 'tracking';

async function getPullRequestOnIssue(issueBody) {
  const index = issueBody.indexOf("#");
  const pullNumber = issueBody.substring(index + 1);
  console.log(`Pull request number: ${pullNumber}`);

  const pullRequest = await octokit.pulls.get({
    repo,
    owner,
    pull_number: pullNumber
  });
  return pullRequest.data;
}

async function getLastCommit(branch) {
    // Workaround for https://github.com/octokit/rest.js/issues/1506
    const urlToGet = `GET /repos/${owner}/${repo}/git/refs/heads/${branch}`;
    const branchInfo = await octokit.request(urlToGet, {
      repo,
      owner,
      branch
      });

    if (branchInfo.status != 200) {
      throw `Failed to get branch branch details for '${branch}' : ${JSON.stringify(branchInfo)}`;
    }
    console.log(JSON.stringify(branchInfo));
    return branchInfo.data.object.sha;
}

async function createNewBranch(branchName, targetSha) {
  const branchRef = `refs/heads/${branchName}`;

  try{
    const response = await octokit.git.createRef({
      owner,
      repo,
      ref: branchRef,
      sha: targetSha
    });
    if (response.status != 201) {
      console.log("Error Response status" + response.status);
    }

    return { status: "CREATED", branchRef };
  } catch(err){
    if(err.toString() === "HttpError: Reference already exists"){
      return { status: "ALREADY_EXISTS", branchRef };
    }
    throw err;
  }
}

async function getCommitShasInPr(pullNumber) {
    const pullRequestCommits = await octokit.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
    });
    if (pullRequestCommits.status != 200) {
      throw `Failed to get commits on PR ${pullNumber}: ${JSON.stringify(response)}`;
    }

    return pullRequestCommits.data.map(c => c.sha);
}

async function cherryPick(commitShas, branchName) {
    const newHeadSha = await cherryPickCommits({
      commits: commitShas,
      head: branchName,
      octokit,
      owner,
      repo,
    });
    console.log(`New head after cherry pick: ${newHeadSha}`);
    return newHeadSha;
}

async function openPullRequestExists(newBranch, targetBranchName) {
  const response = await octokit.pulls.list({
    owner,
    repo,
    state: "open",
    head: newBranch,
    base: targetBranchName
  });
  
  return response.data.length > 0;
}

async function createPullRequest(title, head, base, body) {
    const result = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base
    });
    console.log(`Pull request was created ${JSON.stringify(result)}`);
}

async function commentOnIssueForPr(issueNumber, body) {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  });
}

const CHERRY_PICK_LABEL = "cherry-pick";

async function run() {
  try {
    const payload = github.context.payload;

    // // const payloadFile = fs.readFileSync( 'C:\\Scratch\\github_issue_context.json');
    // // console.log(payloadFile.toString());
    // // const payload = JSON.parse(payloadFile.toString()).event;

    const pullRequest = payload.pull_request;

    const targetBranches = pullRequest.labels
      .filter(label => label.name.startsWith(CHERRY_PICK_LABEL))
      .map(label => label.name.split(":")[1])
      .filter(label => !!label);
    
    for (const targetBranch of targetBranches) {
      try { 
        console.log(`Getting latest commit for branch ${targetBranch}`);
        const targetSha = await getLastCommit(targetBranch);

        const newBranchName = `${pullRequest.number}-${pullRequest.head.ref}-${targetBranch}`;
        console.log(`Creating a branch ${newBranchName} with sha ${targetSha}`);
        const newBranch = await createNewBranch(newBranchName, targetSha);
    
        if(newBranch.status === "CREATED") {
          console.log(`Getting commits for PR ${pullRequest.number}`)
          const commitShas = await getCommitShasInPr(pullRequest.number);
  
          console.log(`Cherry picking commits '${commitShas}' on '${newBranchName}'`);
          await cherryPick(commitShas, newBranchName);
        } else {
          console.log(`Branch ${newBranchName} is already created`)
        }

        const newTitle = `[${targetBranch}] ${pullRequest.title}`;

        console.log(`Opening a PR against ${targetBranch}, on ${newBranch.branchRef} and title '${newTitle}'`);

        const pullRequestAlreadyExists = await openPullRequestExists(newBranch, targetBranch);
        if(pullRequestAlreadyExists) {
          console.log('Pull request is already opened');
        } else {
          const prBody = `Cherry picked from https://${payload.repository.owner.name}/${payload.repository.name}/pull/${pullRequest.number}`;
          await createPullRequest(newTitle, newBranch.branchRef, targetBranch, prBody);
          console.log('Pull request has been opened');
        }
      } catch (ex) {
        console.log(`Failed to cherry-pick commits due to error '${ex}'`);
        console.log('Updating tracking issue with cherry-pick error');
      }
    }
    // if (!validLabels.includes(label)) {
    //   throw `Invalid label applied: '${label}'`;
    // }
    // if (!issue.labels.map(x => x.name).includes(trackingLabel)) {
    //   throw `Issue does not have a tracking label`;
    // }

    // const pullRequest= await getPullRequestOnIssue(issue.body);

    // const targetBranch = label;
    // console.log(`The target branch is ${targetBranch}`);

    // console.log(`Getting latest commit for branch ${targetBranch}`);
    // const targetSha = await getLastCommit(targetBranch);

    // const newBranchName = `${pullRequest.head.ref}-${targetBranch}`;
    // console.log(`Creating a branch ${newBranchName} with sha ${targetSha}`);
    // const newBranchRef = await createNewBranch(newBranchName, targetSha);

    // console.log(`Getting commits for PR ${pullRequest.number}`)
    // const commitShas = await getCommitShasInPr(pullRequest.number);

    // try {

    //   console.log(`Cherry picking commits '${commitShas}' on '${newBranchName}'`);
    //   const newHeadSha = await cherryPick(commitShas, newBranchName);

    //   const newTitle = `[${targetBranch}] ${pullRequest.title}`;

    //   console.log(`Opening a PR against ${targetBranch}, with head ${newHeadSha} on ${newBranchRef} and title '${newTitle}'`);
    //   const prBody = `Tracked by ${payload.owner.name}/${payload.repository.name}#${issue.number}`;
    //   await createPullRequest(newTitle, newBranchRef, targetBranch, prBody);
    //   console.log('Pull request has been opened');

    // } catch (ex) {

    //   console.log(`Failed to cherry-pick commits due to error '${ex}'`);
    //   console.log('Updating tracking issue with cherry-pick error');
    //   var newBody = `PR Promotion to ${label} failed due to '${ex}'.\nCommits to be cherry-picked:\n`;
    //   for (var i = 0; i < commitShas.length; i++) {
    //     newBody += `${commitShas[i]}\n`;
    //   }
    //   await commentOnIssueForPr(issue.number, newBody);

    // }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();