// src/UserService.ts

class UserService {
  private users: { id: number; name: string }[] = [];

  public addUser(name: string): number {
    const newUser = {
      id: this.users.length + 1,
      name,
    };
    this.users.push(newUser);
    return newUser.id;
  }

  public getUser(id: number): { id: number; name: string } | undefined {
    return this.users.find(user => user.id === id);
  }

  public getAllUsers(): { id: number; name: string }[] {
    return this.users;
  }

  public deleteUser(id: number): boolean {
    const index = this.users.findIndex(user => user.id === id);
    if (index !== -1) {
      this.users.splice(index, 1);
      return true;
    }
    return false;
  }
}

export default UserService;
