from __future__ import annotations

import factory
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.gifts.models import GiftIdea, Wish, WishList

User = get_user_model()


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User

    email = factory.Sequence(lambda n: f"utente{n}@regalino.test")
    display_name = factory.Sequence(lambda n: f"Utente {n}")
    is_active = True

    @factory.post_generation
    def password(obj, create, extracted, **kwargs):
        obj.set_password(extracted or "password-di-prova")
        if create:
            obj.save()


class WishListFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = WishList

    owner = factory.SubFactory(UserFactory)
    title = factory.Sequence(lambda n: f"Lista {n}")


class WishFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Wish

    wish_list = factory.SubFactory(WishListFactory)
    title = factory.Sequence(lambda n: f"Regalo {n}")


class GiftIdeaFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GiftIdea

    owner = factory.SubFactory(UserFactory)
    recipient = "Mamma"
    title = factory.Sequence(lambda n: f"Idea {n}")


@pytest.fixture
def user(db):
    return UserFactory()


@pytest.fixture
def other_user(db):
    return UserFactory()


@pytest.fixture
def wish_list(db, user):
    return WishListFactory(owner=user)


@pytest.fixture
def api(db):
    def _client(as_user=None):
        client = APIClient()
        if as_user is not None:
            client.force_authenticate(user=as_user)
        return client

    return _client
