import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(email: string, password: string, name?: string) {
    if (!email || !password) throw new BadRequestException('email and password required');
    if (password.length < 8) throw new BadRequestException('password must be at least 8 characters');

    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) throw new ConflictException('account with this email already exists');

    const passwordHash = await hash(password);
    return this.prisma.user.create({
      data: { email: normalized, passwordHash, name: name?.trim() || null },
    });
  }

  async verifyCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('invalid email or password');
    const ok = await verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid email or password');
    return user;
  }
}
