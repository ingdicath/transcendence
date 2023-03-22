import { Body, Controller, Get, Post, Patch, Query, Req, UseGuards, Delete } from '@nestjs/common';
import { Channel, ChannelMode, User, UserMessage } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards';
import { ChatService } from './chat.service';
import { AddUserToChannelDto } from './dto/add-user-to-channel.dto';
import { ChangePasswordDto } from './dto/change-password-dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreateDMChannelDto } from './dto/create-dm-channel.dto';
import { DeletePasswordDto } from './dto/delete-password.dto';
import { RemoveUserFromChannelDto } from './dto/remove-user-from-channel.dto';


@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
	constructor(private readonly chatService: ChatService) { }

	@Post('createChannel')
	async createChannel(@Req() request, @Body() createChannelDto: CreateChannelDto): Promise<string> {
		const channelMode: ChannelMode = createChannelDto.channelMode;
		const channelName: string = createChannelDto.channelName;
		let password: string = null;
		if (channelMode === 'PROTECTED') {
			password = createChannelDto.password;
		}
		const user: User = request.user;
		return await this.chatService.createChannel(channelMode, channelName, password, user.intraId);
	}

	@Post('createDMChannel')
	async createDMChannel(@Req() request, @Body() createDMChannelDto: CreateDMChannelDto): Promise<string> {
		const user: User = request.user;
		const otherIntraId: number = createDMChannelDto.otherIntraId;
		return await this.chatService.createDMChannel(user, otherIntraId);
	}

	@Post('addUserToChannel')
	async addUserToChannel(@Req() request, @Body() addUserToChannel: AddUserToChannelDto): Promise<void> {
		const user: User = request.user;
		const intraId: number = user.intraId;
		const channelName: string = addUserToChannel.channelName;
		return await this.chatService.addUserToChannel(intraId, channelName);
	}

	@Get('getAllChannels')
	async getAllChannels(): Promise<Channel[]> {
		return await this.chatService.getAllChannels();
	}

	@Get('getMyChannels')
	async getMyChannels(@Req() request): Promise<Channel[]> {
		const user = request.user;
		return await this.chatService.getMyChannels(user);
	}

	@Get('getAllMessagesInChannel')
	async getAllMessagesInChannel(@Query() params: { channelName: string }): Promise<UserMessage[]> {
		const channelName: string = params.channelName;
		return await this.chatService.getAllMessagesInChannel(channelName);
	}

	@Get('checkPassword')
	async checkPassword(@Query() params: { channelName: string, password: string }): Promise<boolean> {
		const channelName: string = params.channelName;
		const password: string = params.password;
		return await this.chatService.checkPassword(channelName, password);
	}

	@Patch('changePassword')
	async changePassword(@Req() request, @Body() changePasswordDto: ChangePasswordDto): Promise<void> {
		const channelName: string = changePasswordDto.channelName;
		const oldPassword: string = changePasswordDto.oldPassword;
		const newPassword: string = changePasswordDto.newPassword;
		const user: User = request.user;
		return await this.chatService.changePassword(user, channelName, oldPassword, newPassword);
	}

	@Patch('deletePassword')
	async deletePassword(@Req() request, @Body() deletePasswordDto: DeletePasswordDto): Promise<void> {
		const channelName: string = deletePasswordDto.channelName;
		const password: string = deletePasswordDto.password;
		const user: User = request.user;
		return await this.chatService.deletePasswordAndSetChannelModeToPublic(user, channelName, password);
	}

	@Patch('setPassword')
	async setPassword(@Req() request, @Body() setPasswordDto: DeletePasswordDto): Promise<void> {
		const channelName: string = setPasswordDto.channelName;
		const password: string = setPasswordDto.password;
		const user: User = request.user;
		return await this.chatService.setPasswordAndSetChannelModeToProtected(user, channelName, password);
	}
}
