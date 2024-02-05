import { Avatar } from "../../components/Avatar"
import { PageTitle } from "../../components/PageTitle"
import { ServerProps, UserData } from "./+data"

export default function ({ data: { users, page } }: ServerProps) {
  return (
    <>
      <PageTitle>Users</PageTitle>
      <div>
        {users.map((user) => (
          <UserCard user={user} />
        ))}
      </div>
      <div className="sticky bottom-0 flex justify-between">
        {page > 1 && <a href={`users?page=${page - 1}`}>Prev</a>}
        <a href={`users?page=${page + 1}`}>Next</a>
      </div>
    </>
  )
}

function UserCard({ user }: { user: UserData }) {
  return (
    <div className="flex gap-2 mb-2 pb-2 items-center border-b-2 border-white border-opacity-5 last:border-b-0">
      <Avatar url={user.image} />
      <a href={`/users/${user.id}`} className="text-emerald-500">
        {user.firstName} {user.lastName}
      </a>
    </div>
  )
}
