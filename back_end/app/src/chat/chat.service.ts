import { HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Channel, Membership, User, UserMessage, ChannelType, ChannelMode, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { Socket } from 'socket.io';
import { UserClientService } from 'src/user/client/client.service';
import { WsException } from '@nestjs/websockets';
import { Member, Messages } from './types';
import * as argon2 from "argon2";

@Injectable()
export class ChatService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly userClientService: UserClientService
	) { }

	private readonly logger: Logger = new Logger('UserService initialized');

	async createChannel(channelMode: ChannelMode, channelName: string, password: string, intraId: number): Promise<string> {
		const existingChannel: Channel = await this.getChannel(channelName);
		if (existingChannel)
			throw new HttpException({ reason: `Channel ${channelName} already exists` }, HttpStatus.BAD_REQUEST);

		let hashed_password: string;
		if (password !== null) {
			hashed_password = await this.createHashedPassword(password);
		}
		else {
			hashed_password = '';
		}
		try {
			const newChannel = await this.prisma.channel.create({
				data: {
					channelMode: channelMode,
					channelName: channelName,
					channelType: 'NORMAL',
					password: hashed_password,
					memberships: {
						create: {
							role: 'OWNER',
							user: {
								connect: {
									intraId: intraId
								},
							},
						},
					},
				},
			});
			return (newChannel.channelName);
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async createDMChannel(user: User, otherIntraId: number): Promise<string> {
		const getChannel = (intraId: number, otherIntraId: number): string => {
			let members: string[] = [intraId.toString(), otherIntraId.toString()];
			members = members.sort();
			return (`${members.at(0)}&${members.at(1)}`);
		}
		const channelName: string = getChannel(user.intraId, otherIntraId);

		const existingChannel: Channel = await this.getChannel(channelName);
		if (existingChannel)
			throw new HttpException({ reason: 'Channel already exists' }, HttpStatus.BAD_REQUEST);

		try {
			await this.prisma.channel.create({
				data: {
					channelMode: 'PRIVATE',
					channelName: channelName,
					channelType: 'DM',
					memberships: {
						create: {
							user: {
								connect: {
									intraId: user.intraId
								},
							},
						},
					},
				},
			});
			this.addUserToChannel(otherIntraId, channelName);
			return channelName;
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async addUserToChannel(intraId: number, channelName: string): Promise<void> {
		try {
			const channel: Channel = await this.getChannel(channelName);
			if (!channel) {
				throw new HttpException({ reason: `Channel ${channelName} was not found` }, HttpStatus.BAD_REQUEST);
			}

			const isInChannel: boolean = !!await this.prisma.membership.findFirst({
				where: {
					intraId: intraId,
					channelName: channelName,
				},
			});
			if (isInChannel === true) {
				throw new HttpException({ reason: `User is already a member of ${channelName}` }, HttpStatus.BAD_REQUEST);
			}

			await this.prisma.membership.create({
				data: {
					user: {
						connect: {
							intraId: intraId,
						},
					},
					channel: {
						connect: {
							channelName: channelName,
						}
					},
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async removeUserFromChannel(intraId: number, channelName: string): Promise<void> {
		try {
			const role: Role = await this.getRole(intraId, channelName);
			const count: number = await this.getAmountOfMembersInChannel(channelName);
			console.log(role, count);
			if (count === 1) {
				return (this.deleteChannel(channelName));
			}
			await this.prisma.membership.delete({
				where: {
					intraId_channelName: {
						intraId: intraId,
						channelName: channelName,
					}
				}
			});
			if (role === 'OWNER') {
				return (this.transferOwnership(channelName));
			}
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async deleteChannel(channelName: string): Promise<void> {
		try {
			await this.prisma.channel.delete({
				where: {
					channelName: channelName,
				}
			})
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async transferOwnership(channelName: string): Promise<void> {
		try {
			let member: Membership = await this.prisma.membership.findFirst({
				where: {
					channelName: channelName,
					role: 'ADMIN',
				},
			});
			if (!member) {
				member = await this.prisma.membership.findFirst({
					where: {
						channelName: channelName,
					},
				});
			}
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: member.intraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'OWNER',
				},
			});
			member = await this.prisma.membership.findFirst({
				where: {
					channelName: channelName,
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async getChannel(channelName: string): Promise<Channel> {
		try {
			const channel: Channel = await this.prisma.channel.findUnique({
				where: {
					channelName: channelName,
				},
			});
			return channel;
		} catch (error: any) {
			throw new HttpException(`Cannot find channel: ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	async getMembersWithUser(channelName: string): Promise<(Membership & { user: User; })[]> {
		try {
			const members: (Membership & { user: User })[] = await this.prisma.membership.findMany({
				where: {
					channelName: channelName,
				},
				include: {
					user: true,
				},
			});
			return members;
		} catch (error: any) {
			throw new HttpException(`Cannot find channel: ${channelName} with members`, HttpStatus.BAD_REQUEST);
		}
	}

	async getAllChannels(): Promise<Channel[]> {
		try {
			const channels: Channel[] = await this.prisma.channel.findMany({});
			return channels;
		} catch (error: any) {
			throw new HttpException('Cannot find channels', HttpStatus.BAD_REQUEST);
		}
	}

	async getMyChannels(user: User): Promise<Channel[]> {
		try {
			const memberships: { channelName: string }[] = await this.prisma.membership.findMany({
				where: {
					intraId: user.intraId,
				},
				select: {
					channelName: true,
				}
			});

			const channels: Channel[] = await Promise.all(
				memberships.map((membership) =>
					this.prisma.channel.findUnique({ where: { channelName: membership.channelName } })
				)
			);
			return channels;
		} catch (error: any) {
			throw new HttpException(`Cannot find ${user.name}'s channels`, HttpStatus.BAD_REQUEST);
		}
	}

	async getAllMessagesInChannel(channelName: string): Promise<UserMessage[]> {
		try {
			const channel: Channel & {
				userMessages: UserMessage[];
			} = await this.prisma.channel.findUnique({
				where: {
					channelName: channelName,
				},
				include: {
					userMessages: true,
				}
			});
			return channel.userMessages;
		} catch (error: any) {
			throw new HttpException(`Cannot find messages in ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	async handleChannelMessage(client: Socket, channelName: string, text: string): Promise<Messages> {
		const intraId: number = await this.userClientService.getClientIntraId(client.id);
		if (!intraId)
			throw new WsException({ reason: `Client is invalid` });

		const user: User = await this.prisma.user.findUnique({
			where: {
				intraId: intraId,
			},
		});

		if (!user) {
			throw new WsException({ reason: `Client is invalid` });
		}

		const message: Messages = {
			intraId: intraId,
			name: user.name,
			text: text,
		};

		try {
			this.addMessageToChannel(intraId, channelName, user.name, text);
			return (message);
		} catch (error: any) {
			throw new WsException(error.message);
		}
	}

	async addMessageToChannel(intraId: number, channelName: string, name: string, text: string): Promise<void> {
		const channel = await this.prisma.channel.findUnique({ where: { channelName } });
		if (!channel) {
			throw new HttpException({ reason: `Channel ${channelName} was not found` }, HttpStatus.BAD_REQUEST);
		}

		try {
			await this.prisma.userMessage.create({
				data: {
					intraId: intraId,
					name: name,
					text: text,
					channel: {
						connect: { channelName },
					},
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async checkPassword(channelName: string, password: string): Promise<boolean> {
		try {
			const channel: Channel = await this.getChannel(channelName);

			const hashed_password: string = channel.password;

			return (argon2.verify(hashed_password, password));
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async changePassword(user: User, channelName: string, oldPassword: string, newPassword: string): Promise<void> {
		await this.checkCredentials(user, channelName, oldPassword);

		try {
			const hashed_password = await this.createHashedPassword(newPassword);

			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: hashed_password,
				}
			})
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async deletePasswordAndSetChannelModeToPublic(user: User, channelName: string, password: string): Promise<void> {
		await this.checkCredentials(user, channelName, password);
		try {
			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: '',
					channelMode: 'PUBLIC',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async setPasswordAndSetChannelModeToProtected(user: User, channelName: string, password: string): Promise<void> {
		await this.checkCredentials(user, channelName, '');
		try {
			const hashed_password = await this.createHashedPassword(password);

			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: hashed_password,
					channelMode: 'PROTECTED',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async checkCredentials(user: User, channelName: string, password: string) {
		if (await this.getRole(user.intraId, channelName) !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to change password', HttpStatus.BAD_REQUEST);
		}
		if (await this.getChannelType(channelName) === 'DM') {
			throw new HttpException('Channel is a direct message and cannot have a password', HttpStatus.BAD_REQUEST);
		}
		if (password !== '' && await this.checkPassword(channelName, password) === false) {
			throw new HttpException('Old password is not correct', HttpStatus.BAD_REQUEST);
		}
	}

	private async getAmountOfMembersInChannel(channelName: string) {
		try {
			const count: number = await this.prisma.membership.count({
				where: {
					channelName: channelName,
				},
			});
			return (count);
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async getRole(intraId: number, channelName: string): Promise<Role> {
		try {
			const membership: Membership = await this.prisma.membership.findUnique({
				where: {
					intraId_channelName: {
						intraId: intraId,
						channelName: channelName,
					},
				},
			});
			const role: Role = membership.role;
			return (role);
		} catch (error: any) {
			throw new HttpException(`Cannot find membership of user with intraId: ${intraId} to ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	private async getChannelType(channelName: string): Promise<ChannelType> {
		try {
			const channel: Channel = await this.getChannel(channelName);
			return (channel.channelType);
		} catch (error: any) {
			throw new HttpException(`Cannot find type of channel: ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	private async createHashedPassword(password: string): Promise<string> {
		const hashed_password: string = await argon2.hash(password);
		return (hashed_password);
	}

	async getMembersInChannel(channelName: string): Promise<Member[]> {
		const membershipsWithUser: (Membership & { user: User; })[] = await this.getMembersWithUser(channelName);
		const members: Member[] = membershipsWithUser.map((member: (Membership & { user: User })) => ({
			intraId: member.user.intraId,
			name: member.user.name,
			avatar: member.user.avatar,
			role: member.role,
		}));
		return members;
	}

	async promoteMemberToAdmin(user: User, channelName: string, otherIntraId: number): Promise<void> {
		const userRole: Role = await this.getRole(user.intraId, channelName);
		const otherUserRole: Role = await this.getRole(otherIntraId, channelName);
		if (userRole !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to promote member', HttpStatus.BAD_REQUEST);
		}
		if (otherUserRole !== 'MEMBER') {
			throw new HttpException('Other user is not a member', HttpStatus.BAD_REQUEST);
		}
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: otherIntraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'ADMIN',
				},
			});
		}
		catch (error: any) {
			throw new InternalServerErrorException();
		}
	}

	async demoteAdminToMember(user: User, channelName: string, otherIntraId: number): Promise<void> {
		const userRole: Role = await this.getRole(user.intraId, channelName);
		const otherUserRole: Role = await this.getRole(otherIntraId, channelName);
		if (userRole !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to demote admin', HttpStatus.BAD_REQUEST);
		}
		if (otherUserRole !== 'ADMIN') {
			throw new HttpException('Other user is not an admin', HttpStatus.BAD_REQUEST);
		}
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: otherIntraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'MEMBER',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException();
		}
	}

	async canBeKicked(user: User, otherIntraId: number, channelName: string): Promise<boolean> {
		const memberships: Membership[] = await this.prisma.membership.findMany({
			where: {
				intraId: {
					in: [user.intraId, otherIntraId],
				},
			},
		})

		const userRole: Role = memberships.find((id) => { id.intraId === user.intraId }).role;
		const otherUserRole: Role = memberships.find((id) => { id.intraId === otherIntraId }).role;

		const rank = {
			OWNER: 3,
			ADMIN: 2,
			MEMBER: 1,
		};

		const userRank: number = rank[userRole];
		const otherUserRank: number = rank[otherUserRole];

		if (userRank > otherUserRank) {
			return (true);
		}
		else {
			return (false);
		}
	}
}
