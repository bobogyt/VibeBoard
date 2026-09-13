import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import {
  deleteGithubToken,
  fetchBranches,
  fetchCommits,
  fetchIssues,
  fetchPulls,
  fetchRepoInfo,
  getGithubConfigInfo,
  importIssueAsTask,
  linkTaskToGithub,
  listGithubLinks,
  saveGithubToken,
  unlinkGithub,
} from '../services/githubService'
import { AuthGuard, GithubRateLimitGuard } from '../http/guards'
import { UserId } from '../http/authed-request'

/** GitHub 集成:Token 配置、仓库浏览、任务关联、Issue 转任务(60 次/分/用户,保护 Token 配额与匿名限速) */
@UseGuards(AuthGuard, GithubRateLimitGuard)
@Controller('github')
export class GithubController {
  @Get('config')
  async config(@UserId() userId: string) {
    return getGithubConfigInfo(userId)
  }

  @Put('config')
  async saveConfig(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    await saveGithubToken(userId, body?.token)
    return getGithubConfigInfo(userId)
  }

  @Delete('config')
  async deleteConfig(@UserId() userId: string) {
    return deleteGithubToken(userId)
  }

  @Get('links')
  async links(@UserId() userId: string) {
    return { links: await listGithubLinks(userId) }
  }

  @Post('links')
  async createLink(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    const { link, taskMovedToDone } = await linkTaskToGithub(userId, body?.taskId, {
      owner: body?.owner,
      repo: body?.repo,
      type: body?.type,
      number: body?.number,
    })
    return { link, taskMovedToDone }
  }

  @Delete('links/:id')
  async removeLink(@UserId() userId: string, @Param('id') id: string) {
    return unlinkGithub(userId, id)
  }

  @Get('repos/:owner/:repo/info')
  async repoInfo(@UserId() userId: string, @Param('owner') owner: string, @Param('repo') repo: string) {
    return fetchRepoInfo(userId, owner, repo)
  }

  @Get('repos/:owner/:repo/issues')
  async issues(
    @UserId() userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('state') state?: string,
    @Query('page') page?: string,
  ) {
    return fetchIssues(userId, owner, repo, { state, page })
  }

  @Get('repos/:owner/:repo/pulls')
  async pulls(
    @UserId() userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('state') state?: string,
    @Query('page') page?: string,
  ) {
    return fetchPulls(userId, owner, repo, { state, page })
  }

  @Get('repos/:owner/:repo/commits')
  async commits(
    @UserId() userId: string,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('branch') branch?: string,
    @Query('page') page?: string,
  ) {
    return fetchCommits(userId, owner, repo, { branch, page })
  }

  @Get('repos/:owner/:repo/branches')
  async branches(@UserId() userId: string, @Param('owner') owner: string, @Param('repo') repo: string) {
    return fetchBranches(userId, owner, repo)
  }

  @Post('import-issue')
  async importIssue(@UserId() userId: string, @Body() body: Record<string, unknown> | undefined) {
    return importIssueAsTask(userId, {
      owner: body?.owner,
      repo: body?.repo,
      number: body?.number,
      projectId: body?.projectId,
    })
  }
}
